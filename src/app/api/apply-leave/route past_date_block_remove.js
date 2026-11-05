import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { normalizeRole, resolveApproverForApplicant } from "@/lib/leave-approval";
import crypto from "crypto";
import { createTransporter } from "@/lib/mailer";
import fs from "fs/promises";
import path from "path";

const getYear = () => new Date().getFullYear();

function normalizeId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if (value._id && value._id !== value) return normalizeId(value._id);
    if (typeof value.toHexString === "function") return value.toHexString();
    if (typeof value.toString === "function") {
      const str = value.toString();
      if (str !== "[object Object]") return str;
    }
  }
  return "";
}

function toObjectIdSafe(value) {
  try {
    return ObjectId.isValid(value) ? new ObjectId(value) : null;
  } catch {
    return null;
  }
}

function getUserIdFromAuth(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = authHeader.split(" ")[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!decoded?.id) throw new Error("Unauthorized");
  return decoded.id;
}

function calculateLeaveDays(fromDate, toDate, isHalfDay) {
  if (isHalfDay) return 0.5;
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return -1;
  if (end < start) return -1;
  const diffTime = end.getTime() - start.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function isDateBeforeToday(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const inputDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return inputDate < today;
}

export async function GET(req) {
  try {
    const userId = getUserIdFromAuth(req);
    const client = await clientPromise;
    const db = client.db("civic_leave_db");
    const requester = await db.collection("users").findOne({ _id: new ObjectId(userId) });
    if (!requester) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const requesterRole = normalizeRole(requester.role);
    const requesterDepartmentId = normalizeId(requester.departmentId);
    const requesterDivisionId = normalizeId(requester.divisionId);

    let userScopeIds = [userId];
    let visibilityLabel = "My Leaves";

    if (["DivisionHead", "DepartmentHead"].includes(requesterRole)) {
      visibilityLabel = "My Department Leaves";
      if (requesterDepartmentId) {
        const departmentMembers = await db.collection("users").find({ departmentId: { $in: [requesterDepartmentId] } }).toArray();
        userScopeIds = departmentMembers.map((u) => normalizeId(u._id)).filter(Boolean);
      }
    } else if (requesterDivisionId) {
      visibilityLabel = "My Division Leaves";
      const divisionMembers = await db.collection("users").find({ divisionId: { $in: [requesterDivisionId] } }).toArray();
      userScopeIds = divisionMembers.map((u) => normalizeId(u._id)).filter(Boolean);
    }

    const leaveApplications = await db.collection("leave_applications").find({ userId: { $in: userScopeIds } }).sort({ createdAt: -1 }).toArray();
    const usersInScope = await db.collection("users").find({ _id: { $in: userScopeIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)) } }).toArray();
    const userNameMap = new Map(usersInScope.map(u => [normalizeId(u._id), u.name || u.email || "-"]));
    const leaveTypes = await db.collection("leave-types").find({}).toArray();
    const leaveTypeMap = new Map(leaveTypes.map(lt => [lt._id.toString(), lt.name]));

    const mapped = leaveApplications.map(entry => ({
      ...entry,
      _id: entry._id.toString(),
      userName: entry.userName || userNameMap.get(normalizeId(entry.userId)) || "-",
      leaveTypeName: entry.leaveTypeName || leaveTypeMap.get(entry.leaveTypeId?.toString()) || "-",
    }));

    return NextResponse.json({ applications: mapped, visibilityLabel });
  } catch (error) {
    if (error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("GET /api/apply-leave error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function saveUploadedFiles(files) {
  if (!files || files.length === 0) return [];
  const uploadDir = path.join(process.cwd(), "public/uploads/leave-attachments");
  await fs.mkdir(uploadDir, { recursive: true });
  const savedFiles = [];
  for (const file of files) {
    const timestamp = Date.now();
    const safeName = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const filePath = path.join(uploadDir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    savedFiles.push(safeName);
  }
  return savedFiles;
}

//====================POST Handler (updated with skipApproval)====================
export async function POST(req) {
  try {
    const userId = getUserIdFromAuth(req);

    const formData = await req.formData();
    const isHalfDay = formData.get("isHalfDay") === "true";
    const leaveTypeId = formData.get("leaveTypeId");
    const fromDate = formData.get("fromDate");
    const toDate = formData.get("toDate");
    const daysRaw = formData.get("days");
    const description = formData.get("description") || "";
    const attachments = formData.getAll("attachments");

    if (!leaveTypeId || !fromDate || !toDate || !daysRaw) {
      return NextResponse.json({ error: "Leave type, dates, and no. of days are required" }, { status: 400 });
    }

    if (isDateBeforeToday(fromDate) || isDateBeforeToday(toDate)) {
      return NextResponse.json({ error: "Past dates are not allowed" }, { status: 400 });
    }

    const parsedDays = Number(daysRaw);
    const calculatedDays = calculateLeaveDays(fromDate, toDate, !!isHalfDay);
    if (calculatedDays <= 0) return NextResponse.json({ error: "Invalid leave date range" }, { status: 400 });
    if (parsedDays <= 0 || parsedDays > calculatedDays) {
      return NextResponse.json({ error: "Invalid number of days" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("civic_leave_db");
    const userObjectId = toObjectIdSafe(userId);
    if (!userObjectId) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });

    const year = getYear();
    const applicantUser = await db.collection("users").findOne({ _id: userObjectId });
    if (!applicantUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Overlap check
    const overlapping = await db.collection("leave_applications").findOne({
      userId: userObjectId,
      status: { $in: ["pending", "approved"] },
      $or: [{ fromDate: { $lte: toDate }, toDate: { $gte: fromDate } }]
    });
    if (overlapping) {
      return NextResponse.json({ error: "You already have a leave application covering some of these dates" }, { status: 400 });
    }

    // ---------- Fetch leave type to check skipApproval ----------
    const leaveTypeDoc = await db.collection("leave-types").findOne({ _id: toObjectIdSafe(leaveTypeId) });
    if (!leaveTypeDoc) return NextResponse.json({ error: "Invalid leave type" }, { status: 400 });
    const skipApproval = leaveTypeDoc.skipApproval === true;

    // Balance check
    const leaveBalance = await db.collection("leave_balances").findOne({ userId: userObjectId, year });
    if (!leaveBalance) return NextResponse.json({ error: "Leave balance not found" }, { status: 404 });
    const leaveType = leaveBalance.leaves?.find(entry => entry.leaveTypeId?.toString() === leaveTypeId);
    if (!leaveType) return NextResponse.json({ error: "Leave type not assigned" }, { status: 400 });
    if (parsedDays > Number(leaveType.balance || 0)) {
      return NextResponse.json({ error: "Insufficient leave balance" }, { status: 400 });
    }

    // Save attachments
    let savedFileNames = [];
    if (attachments && attachments.length > 0) savedFileNames = await saveUploadedFiles(attachments);

    let finalStatus = "pending";
    let resolvedApprover = null;
    let token = null;
    let tokenExpiry = null;

    if (skipApproval) {
      finalStatus = "approved";
      resolvedApprover = { approverId: null, approverName: "Auto-Approved", approverRole: "System" };
    } else {
      try {
        resolvedApprover = await resolveApproverForApplicant(db, applicantUser, { fromDate, toDate });
      } catch (err) {
        console.error("Approver resolution failed:", err);
        return NextResponse.json({ error: "Approver resolution failed" }, { status: 500 });
      }
      if (!resolvedApprover?.approverId) {
        return NextResponse.json({ error: "No approver configured" }, { status: 400 });
      }
      token = crypto.randomBytes(32).toString("hex");
      tokenExpiry = new Date();
      tokenExpiry.setHours(tokenExpiry.getHours() + 24);
    }

    const insertData = {
      userId: userObjectId,
      userName: applicantUser.name || applicantUser.email || "",
      applicantRole: applicantUser.role || "Officer",
      departmentId: applicantUser.departmentId || "",
      divisionId: applicantUser.divisionId || "",
      leaveTypeId,
      leaveTypeName: leaveType.leaveTypeName || "",
      fromDate,
      toDate,
      days: parsedDays,
      isHalfDay: !!isHalfDay,
      description,
      attachments: savedFileNames,
      attachmentName: savedFileNames.join(", "),
      status: finalStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (!skipApproval) {
      insertData.approvingAuthority = resolvedApprover.approverName;
      insertData.approverId = resolvedApprover.approverId;
      insertData.approverRole = resolvedApprover.approverRole;
      insertData.approverName = resolvedApprover.approverName;
    }

    const result = await db.collection("leave_applications").insertOne(insertData);

    if (finalStatus === "approved") {
      await db.collection("leave_balances").updateOne(
        { userId: userObjectId, year },
        { $inc: { [`leaves.$[elem].used`]: parsedDays } },
        { arrayFilters: [{ "elem.leaveTypeId": leaveTypeId }] }
      );
    }

    const transporter = createTransporter();
    // Applicant email (always)
    if (applicantUser?.email) {
      const statusText = finalStatus === "approved" ? "approved" : "submitted for approval";
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: applicantUser.email,
          subject: `Leave Request ${statusText === "approved" ? "Approved" : "Submitted"}`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Leave Request ${statusText === "approved" ? "Approved" : "Submitted"}</h2>
              <p>Hi ${applicantUser.name || "User"},</p>
              <p>Your leave request has been ${statusText}.</p>
              <p><strong>Leave Details:</strong></p>
              <ul>
                <li>Leave Type: ${leaveType.leaveTypeName}</li>
                <li>From: ${fromDate}</li>
                <li>To: ${toDate}</li>
                <li>Days: ${parsedDays}</li>
              </ul>
              ${statusText === "submitted for approval" ? "<p>You will be notified once reviewed.</p>" : "<p>No further action needed.</p>"}
            </div>
          `,
        });
      } catch (err) { console.error("Applicant email failed:", err); }
    }

    // Approver email & token only for pending
    if (!skipApproval && resolvedApprover?.approverId) {
      await db.collection("leave_action_tokens").insertOne({
        token,
        requestId: result.insertedId,
        approverId: resolvedApprover.approverId,
        used: false,
        expiresAt: tokenExpiry,
        createdAt: new Date(),
      });

      const baseUrl = process.env.APP_URL;
      const approveLink = `${baseUrl}/api/apply-leave/email-action?requestId=${result.insertedId}&token=${token}&action=approve`;
      const rejectLink = `${baseUrl}/api/apply-leave/email-action?requestId=${result.insertedId}&token=${token}&action=reject`;

      const mailHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Leave Approval Request</h2>
          <p><strong>Applicant:</strong> ${applicantUser.name || applicantUser.email}</p>
          <p><strong>Leave Type:</strong> ${leaveType.leaveTypeName}</p>
          <p><strong>From:</strong> ${fromDate}</p>
          <p><strong>To:</strong> ${toDate}</p>
          <p><strong>Days:</strong> ${parsedDays}</p>
          <p><strong>Description:</strong> ${description || "-"}</p>
          <hr />
          <a href="${approveLink}" style="background:#28a745; color:white; padding:10px 20px; text-decoration:none; margin-right:10px;">Approve</a>
          <a href="${rejectLink}" style="background:#dc3545; color:white; padding:10px 20px; text-decoration:none;">Reject</a>
        </div>
      `;

      const approverUser = await db.collection("users").findOne({ _id: new ObjectId(resolvedApprover.approverId) });
      if (approverUser?.email) {
        try {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: approverUser.email,
            subject: `Leave Approval Request - ${applicantUser.name || applicantUser.email}`,
            html: mailHtml,
          });
        } catch (emailErr) { console.error("Approver email failed:", emailErr); }
      }
    }

    return NextResponse.json({ message: skipApproval ? "Leave applied and automatically approved" : "Leave applied successfully" }, { status: 201 });
  } catch (error) {
    if (error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("POST /api/apply-leave error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}