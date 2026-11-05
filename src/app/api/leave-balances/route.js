import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const getYear = () => new Date().getFullYear();

// Helper: max total balance for each leave type
const getMaxBalance = (leaveTypeName) => {
  const name = leaveTypeName?.toLowerCase() || "";
  if (name.includes("annual")) return 51;
  return Infinity;
};

// ================= GET (with department/division resolution) =================
export async function GET(req) {
  try {
    const client = await clientPromise;
    const db = client.db("civic_leave_db");

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? parseInt(yearParam) : getYear();

    // Fetch leave types once
    const leaveTypes = await db.collection("leave-types").find({}).toArray();

    // ---------- Fetch departments & divisions for mapping ----------
    const departments = await db.collection("departments").find({}).toArray();
    const divisions = await db.collection("divisions").find({}).toArray();
    const deptMap = Object.fromEntries(
      departments.map(d => [d._id.toString(), d.name || "Unknown"])
    );
    const divMap = Object.fromEntries(
      divisions.map(d => [d._id.toString(), d.name || "Unknown"])
    );
    // --------------------------------------------------------------

    if (userId) {
      let parsedUserId;
      try {
        parsedUserId = new ObjectId(userId);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid user ID" }), { status: 400 });
      }

      const user = await db.collection("users").findOne({ _id: parsedUserId });
      if (!user) {
        return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
      }

      let single = await db.collection("leave_balances").findOne({
        userId: parsedUserId,
        year,
      });

      if (!single) {
        const leaves = leaveTypes.map((lt) => ({
          leaveTypeId: lt._id,
          leaveTypeName: lt.name,
          allocated: 0,
          used: 0,
          balance: 0,
        }));

        const insertResult = await db.collection("leave_balances").insertOne({
          userId: parsedUserId,
          userName: user.name || user.fullName || user.email || "",
          year,
          leaves,
          remarks: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        single = await db.collection("leave_balances").findOne({ _id: insertResult.insertedId });
      } else {
        // Sync missing leave types
        const existingIds = single.leaves.map((l) => l.leaveTypeId.toString());
        const missing = leaveTypes.filter((lt) => !existingIds.includes(lt._id.toString()));
        if (missing.length > 0) {
          const newEntries = missing.map((lt) => ({
            leaveTypeId: lt._id,
            leaveTypeName: lt.name,
            allocated: 0,
            used: 0,
            balance: 0,
          }));
          await db.collection("leave_balances").updateOne(
            { _id: single._id },
            {
              $push: { leaves: { $each: newEntries } },
              $set: { updatedAt: new Date() },
            }
          );
          single.leaves = [...single.leaves, ...newEntries];
        }
      }

      // Resolve department & division names from maps
      const deptName = user.departmentId ? deptMap[user.departmentId.toString()] || "" : "";
      const divName = user.divisionId ? divMap[user.divisionId.toString()] || "" : "";
      single.department = deptName;
      single.division = divName;

      return new Response(JSON.stringify(single), { status: 200 });
    }

    // ---------- All users ----------
    const users = await db.collection("users").find({}).toArray();
    const results = [];

    for (const user of users) {
      let record = await db.collection("leave_balances").findOne({
        userId: user._id,
        year,
      });

      if (!record) {
        const leaves = leaveTypes.map((lt) => ({
          leaveTypeId: lt._id,
          leaveTypeName: lt.name,
          allocated: 0,
          used: 0,
          balance: 0,
        }));
        const insertResult = await db.collection("leave_balances").insertOne({
          userId: user._id,
          userName: user.name || user.fullName || user.email || "",
          year,
          leaves,
          remarks: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        record = await db.collection("leave_balances").findOne({ _id: insertResult.insertedId });
      } else {
        const existingIds = record.leaves?.map((l) => l.leaveTypeId.toString()) || [];
        const missing = leaveTypes.filter((lt) => !existingIds.includes(lt._id.toString()));
        if (missing.length > 0) {
          const newEntries = missing.map((lt) => ({
            leaveTypeId: lt._id,
            leaveTypeName: lt.name,
            allocated: 0,
            used: 0,
            balance: 0,
          }));
          await db.collection("leave_balances").updateOne(
            { _id: record._id },
            {
              $push: { leaves: { $each: newEntries } },
              $set: { updatedAt: new Date() },
            }
          );
          record.leaves = [...(record.leaves || []), ...newEntries];
        }
      }

      // Resolve department & division names from maps
      const deptName = user.departmentId ? deptMap[user.departmentId.toString()] || "" : "";
      const divName = user.divisionId ? divMap[user.divisionId.toString()] || "" : "";

      results.push({
        ...record,
        userName: user.name || user.fullName || user.email || "No Name",
        department: deptName,
        division: divName,
      });
    }

    return new Response(JSON.stringify(results), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// ================= POST (unchanged) =================
export async function POST(req) {
  try {
    const client = await clientPromise;
    const db = client.db("civic_leave_db");

    const { year, allocation } = await req.json();
    if (!year || !allocation) {
      return new Response(JSON.stringify({ error: "Year and allocation data are required" }), { status: 400 });
    }

    const leaveTypes = await db.collection("leave-types").find({}).toArray();
    const cappedInfo = [];

    // Validate inputs
    for (const lt of leaveTypes) {
      const raw = Number(allocation[lt._id] || 0);
      if (isNaN(raw) || raw < 0) {
        return new Response(
          JSON.stringify({ error: `Invalid number for ${lt.name}` }),
          { status: 400 }
        );
      }
    }

    const prevYear = year - 1;
    const users = await db.collection("users").find({}).toArray();

    for (const user of users) {
      const existing = await db.collection("leave_balances").findOne({
        userId: user._id,
        year,
      });
      const prev = await db.collection("leave_balances").findOne({
        userId: user._id,
        year: prevYear,
      });

      const leaves = [];

      for (const lt of leaveTypes) {
        const rawAllocation = Number(allocation[lt._id] || 0);
        let carry = 0;
        if (prev) {
          const prevLeave = prev.leaves?.find(
            (l) => l.leaveTypeId.toString() === lt._id.toString()
          );
          if (prevLeave) carry = prevLeave.balance;
        }

        let used = 0;
        if (existing) {
          const existingLeave = existing.leaves?.find(
            (l) => l.leaveTypeId.toString() === lt._id.toString()
          );
          if (existingLeave) used = existingLeave.used || 0;
        }

        const isAnnual = lt.name?.toLowerCase().includes("annual");
        const isCasual = lt.name?.toLowerCase().includes("casual");
        const isEOL = lt.name?.toLowerCase().includes("eol");

        let finalBalance = 0;

        if (isAnnual) {
          const totalEntitlement = carry + rawAllocation;
          const maxCap = getMaxBalance(lt.name);
          let cappedTotal = totalEntitlement;
          if (cappedTotal > maxCap) {
            cappedInfo.push({
              leaveType: lt.name,
              originalTotal: totalEntitlement,
              cappedTo: maxCap,
            });
            cappedTotal = maxCap;
          }
          finalBalance = cappedTotal;
        } else if (isCasual || isEOL) {
          finalBalance = rawAllocation;
        } else {
          const totalEntitlement = rawAllocation;
          const maxCap = getMaxBalance(lt.name);
          let cappedTotal = totalEntitlement;
          if (cappedTotal > maxCap) {
            cappedInfo.push({
              leaveType: lt.name,
              originalTotal: totalEntitlement,
              cappedTo: maxCap,
            });
            cappedTotal = maxCap;
          }
          finalBalance = cappedTotal;
        }

        leaves.push({
          leaveTypeId: lt._id,
          leaveTypeName: lt.name,
          allocated: rawAllocation,
          used: used,
          balance: finalBalance,
        });
      }

      await db.collection("leave_balances").updateOne(
        { userId: user._id, year },
        {
          $set: {
            userName: user.name || user.fullName || user.email || "",
            leaves,
            remarks: "",
            updatedAt: new Date(),
          },
          $setOnInsert: {
            userId: user._id,
            year,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
    }

    let responseMessage = `Leave allocation completed for ${year}`;
    if (cappedInfo.length > 0) {
      const details = cappedInfo.map(
        (c) => `${c.leaveType}: total ${c.originalTotal} → ${c.cappedTo} days`
      ).join(", ");
      responseMessage += ` (capped: ${details})`;
    }

    return new Response(
      JSON.stringify({ message: responseMessage, capped: cappedInfo }),
      { status: 201 }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// ================= PUT (unchanged) =================
export async function PUT(req) {
  try {
    const client = await clientPromise;
    const db = client.db("civic_leave_db");

    const { _id, leaves, remarks } = await req.json();
    if (!_id) throw new Error("ID required");

    const existing = await db.collection("leave_balances").findOne({ _id: new ObjectId(_id) });
    if (!existing) throw new Error("Record not found");

    const year = existing.year;
    const prevYear = year - 1;
    const user = await db.collection("users").findOne({ _id: existing.userId });
    if (!user) throw new Error("User not found");

    const prevRecord = await db.collection("leave_balances").findOne({
      userId: existing.userId,
      year: prevYear,
    });

    const cappedInfo = [];
    const updatedLeaves = [];

    for (const newLeaf of leaves) {
      const oldLeaf = existing.leaves.find(
        (l) => l.leaveTypeId.toString() === newLeaf.leaveTypeId.toString()
      );

      const newAllocated = Number(newLeaf.allocated) || 0;
      const isAnnual = newLeaf.leaveTypeName?.toLowerCase().includes("annual");

      let used = 0;
      if (oldLeaf) used = Number(oldLeaf.used) || 0;

      let balance = 0;
      let carry = 0;

      if (isAnnual) {
        if (prevRecord) {
          const prevLeave = prevRecord.leaves?.find(
            (l) => l.leaveTypeId.toString() === newLeaf.leaveTypeId.toString()
          );
          if (prevLeave) carry = Number(prevLeave.balance) || 0;
        }
        const total = carry + newAllocated;
        const maxCap = getMaxBalance(newLeaf.leaveTypeName);
        if (total > maxCap) {
          cappedInfo.push({
            leaveType: newLeaf.leaveTypeName,
            originalTotal: total,
            cappedTo: maxCap,
          });
          balance = maxCap;
        } else {
          balance = total;
        }
      } else {
        balance = newAllocated;
        const maxCap = getMaxBalance(newLeaf.leaveTypeName);
        if (balance > maxCap) {
          cappedInfo.push({
            leaveType: newLeaf.leaveTypeName,
            originalTotal: balance,
            cappedTo: maxCap,
          });
          balance = maxCap;
        }
      }

      updatedLeaves.push({
        leaveTypeId: newLeaf.leaveTypeId,
        leaveTypeName: newLeaf.leaveTypeName,
        allocated: newAllocated,
        used: used,
        balance: balance,
      });
    }

    await db.collection("leave_balances").updateOne(
      { _id: new ObjectId(_id) },
      {
        $set: {
          leaves: updatedLeaves,
          remarks: remarks || "",
          updatedAt: new Date(),
        },
      }
    );

    let responseMessage = "Updated successfully";
    if (cappedInfo.length > 0) {
      const details = cappedInfo.map(
        (c) => `${c.leaveType}: total ${c.originalTotal} → ${c.cappedTo} days`
      ).join(", ");
      responseMessage += ` (capped: ${details})`;
    }

    return new Response(
      JSON.stringify({ message: responseMessage, capped: cappedInfo }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// ================= DELETE (unchanged) =================
export async function DELETE(req) {
  try {
    const client = await clientPromise;
    const db = client.db("civic_leave_db");

    const { _id } = await req.json();
    if (!_id) throw new Error("ID required");

    await db.collection("leave_balances").deleteOne({ _id: new ObjectId(_id) });

    return new Response(JSON.stringify({ message: "Deleted successfully" }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}