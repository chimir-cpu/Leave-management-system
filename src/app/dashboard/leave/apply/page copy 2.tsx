"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { FaUpload } from 'react-icons/fa';
import { Badge, Box, Button, Card, Checkbox, Flex, Heading, Separator, Text, TextArea, TextField } from "@radix-ui/themes";

type LeaveType = {
  _id: string;
  name: string;
};

type LeaveEntry = {
  leaveTypeId: string;
  leaveTypeName: string;
  balance: number;
};

type Holiday = {
  id: string;
  start_date: string;
  end_date: string;
  type: string;
};

function getTodayLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Helper: check if a date falls inside any holiday range
function isDateInHolidays(date: Date, holidays: Holiday[]): boolean {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return holidays.some(hol => {
    const start = new Date(hol.start_date);
    const end = new Date(hol.end_date);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return target >= start && target <= end;
  });
}

// Calculate leave days excluding weekends (Sat/Sun) and holidays
function calculateLeaveDays(startDateStr: string, endDateStr: string, holidays: Holiday[]): number {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const isHoliday = isDateInHolidays(current, holidays);
    if (!isWeekend && !isHoliday) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export default function ApplyLeavePage() {
  const router = useRouter();
  const minSelectableDate = getTodayLocalDateString();

  const [isHalfDay, setIsHalfDay] = useState(false);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [days, setDays] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveEntries, setLeaveEntries] = useState<LeaveEntry[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]); // NEW

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  // Fetch holidays once
  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const res = await fetch("/api/holidays");
        if (res.ok) {
          const data = await res.json();
          setHolidays(data);
        }
      } catch (err) {
        console.error("Failed to fetch holidays", err);
      }
    };
    fetchHolidays();
  }, []);

  // Load user data (profile, leave types, balances)
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setMessage("");

      try {
        const profileRes = await fetch("/api/user/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (profileRes.status === 401) {
          localStorage.removeItem("token");
          localStorage.removeItem("isAdmin");
          router.push("/login?expired=true");
          return;
        }

        const profile = await profileRes.json();

        const [typesRes, balanceRes] = await Promise.all([
          fetch("/api/leave-types"),
          fetch(`/api/leave-balances?userId=${profile?._id}`),
        ]);

        const typesData = await typesRes.json();
        const balanceData = await balanceRes.json();

        setLeaveTypes(Array.isArray(typesData) ? typesData : []);
        setLeaveEntries(Array.isArray(balanceData?.leaves) ? balanceData.leaves : []);
      } catch (error) {
        console.error("Apply leave data load error:", error);
        setMessage("Failed to load leave form data");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [router]);

  const selectedBalance = useMemo(() => {
    const selected = leaveEntries.find(
      (entry) => entry.leaveTypeId?.toString() === leaveTypeId,
    );
    return Number(selected?.balance || 0);
  }, [leaveEntries, leaveTypeId]);

  // ✅ NEW: Calculate days automatically (excludes weekends & holidays)
  useEffect(() => {
    if (isHalfDay) {
      setDays("0.5");
      return;
    }

    if (!fromDate || !toDate) {
      setDays("");
      return;
    }

    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (end < start) {
      setDays("");
      return;
    }

    const computedDays = calculateLeaveDays(fromDate, toDate, holidays);
    setDays(String(computedDays));
  }, [isHalfDay, fromDate, toDate, holidays]);

  const handleReset = () => {
    setIsHalfDay(false);
    setLeaveTypeId("");
    setFromDate("");
    setToDate("");
    setDays("");
    setDescription("");
    setAttachments([]);
    setMessage("");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      setAttachments((prev) => [...prev, ...files]);
    }
    e.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const parsedDays = Number(days);

    if (!leaveTypeId || !fromDate || !toDate || !parsedDays) {
      setMessage("Please fill all required fields");
      return;
    }

    if (fromDate < minSelectableDate || toDate < minSelectableDate) {
      setMessage("Past dates are not allowed. Please select today or future dates");
      return;
    }

    if (parsedDays > selectedBalance) {
      setMessage("No. of days cannot exceed assigned leave balance");
      return;
    }

    try {
      setSubmitting(true);
      setMessage("");

      const token = localStorage.getItem("token");
      const formData = new FormData();
      formData.append("isHalfDay", String(isHalfDay));
      formData.append("leaveTypeId", leaveTypeId);
      formData.append("fromDate", fromDate);
      formData.append("toDate", toDate);
      formData.append("days", String(parsedDays));
      formData.append("description", description);
      attachments.forEach((file) => {
        formData.append("attachments", file);
      });

      const res = await fetch("/api/apply-leave", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(data?.error || "Failed to apply leave");
        return;
      }

      router.push("/dashboard/leave");
    } catch (error) {
      console.error("Apply leave submit error:", error);
      setMessage("Failed to apply leave");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Text color="gray">Loading leave form...</Text>
      </div>
    );
  }

  return (
    <div className="flex bg-slate-50 min-h-screen">
      <Sidebar />

      <main className="flex-1 p-6 ml-64">
        <Flex align="center" justify="between" mb="5">
          <Box>
            <Heading size="6">Apply Leave</Heading>
            <Text size="2" color="gray">
              Weekends and registered holidays are automatically excluded.
            </Text>
          </Box>
          <Button onClick={() => router.push("/dashboard/leave")} variant="soft">
            Leave Details
          </Button>
        </Flex>

        <Card size="3">
          <form onSubmit={handleSubmit}>
            <Flex direction="column" gap="4">
              <Flex wrap="wrap" gap="3" align="center" justify="between">
                <Flex gap="2" align="center">
                  <Checkbox
                    checked={isHalfDay}
                    onCheckedChange={(checked) => setIsHalfDay(checked === true)}
                  />
                  <Text size="2">Half-day leave</Text>
                </Flex>
                <Badge variant="soft" color="blue">
                  Hierarchy approval enabled
                </Badge>
              </Flex>

              <Separator size="4" />

              <div className="grid md:grid-cols-4 gap-4 items-end">
                <Box>
                  <Text as="label" size="2" weight="medium">
                    Leave Type
                  </Text>
                  <select
                    className="w-full border border-slate-300 bg-white rounded-md px-3 py-2 mt-1"
                    value={leaveTypeId}
                    onChange={(e) => setLeaveTypeId(e.target.value)}
                    required
                  >
                    <option value="">Select Leave Type</option>
                    {leaveTypes.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Box>

                <Box>
                  <Text as="label" size="2" weight="medium">
                    Start Date
                  </Text>
                  <TextField.Root
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    min={minSelectableDate}
                    required
                    mt="1"
                  />
                </Box>

                <Box>
                  <Text as="label" size="2" weight="medium">
                    End Date
                  </Text>
                  <TextField.Root
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    min={fromDate || minSelectableDate}
                    required
                    mt="1"
                  />
                </Box>

                <Box>
                  <Text as="label" size="2" weight="medium">
                    No. of Days
                  </Text>
                  <TextField.Root
                    type="number"
                    step={isHalfDay ? "0.5" : "1"}
                    min={isHalfDay ? "0.5" : "1"}
                    max={selectedBalance || undefined}
                    value={days}
                    readOnly   // ✅ Make it read-only to prevent manual mismatch
                    required
                    mt="1"
                  />
                  <Text size="1" color="gray" mt="1">
                    Available balance: {selectedBalance}
                  </Text>
                  <Text size="1" color="gray">
                    (Excludes weekends & holidays)
                  </Text>
                </Box>
              </div>

              {/* File attachments */}
              <Box>
                <div className="flex items-center gap-2 mb-1">
                  <Text as="label" size="2" weight="medium">
                    Attach Files (optional)
                  </Text>
                  <label className="cursor-pointer text-gray-400 hover:text-gray-600">
                    <FaUpload />
                    <input
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                </div>
                {attachments.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {attachments.map((file, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-gray-100 px-3 py-2 rounded text-sm">
                        <span className="text-gray-700">{file.name}</span>
                        <button type="button" onClick={() => handleRemoveFile(idx)} className="text-red-500">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Box>

              {/* Description */}
              <Box>
                <Text as="label" size="2" weight="medium">
                  Description
                </Text>
                <TextArea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter leave description"
                  style={{ minHeight: 120 }}
                  mt="1"
                />
              </Box>

              <Flex gap="3" pt="2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit"}
                </Button>
                <Button type="button" variant="soft" color="gray" onClick={handleReset}>
                  Reset
                </Button>
              </Flex>

              {message && (
                <Text size="2" color="red">
                  {message}
                </Text>
              )}
            </Flex>
          </form>
        </Card>
      </main>
    </div>
  );
}