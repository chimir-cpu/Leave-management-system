"use client";

import React, { useState, useEffect } from "react";
import { Trash2, Pencil, Save, Check, X, Plus } from "lucide-react";
import Sidebar from "@/components/Sidebar";

export default function LeaveBalancesPage() {
  const [data, setData] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editData, setEditData] = useState(null);
  const [formData, setFormData] = useState({});
  const [remarks, setRemarks] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [notification, setNotification] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const fetchData = async (year) => {
    const res = await fetch(`/api/leave-balances?year=${year}`);
    const json = await res.json();
    setData(json);
  };

  const fetchLeaveTypes = async () => {
    const res = await fetch("/api/leave-types");
    const json = await res.json();
    setLeaveTypes(json);
  };

  useEffect(() => {
    fetchData(selectedYear);
    fetchLeaveTypes();
  }, [selectedYear]);

  const showNotification = (message, type = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const hasBulkAllocationOccurred = () => {
    return data.some(user =>
      user.leaves?.some(leave => (leave.allocated || 0) > 0)
    );
  };

  // ================= ADD =================
  const handleAdd = async () => {
    if (hasBulkAllocationOccurred()) {
      showNotification(
        `Bulk leave allocation has already been done for ${selectedYear}. You can only allocate once per year.`,
        "error"
      );
      return;
    }

    try {
      await fetch("/api/leave-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: selectedYear,
          allocation: formData,
        }),
      });

      fetchData(selectedYear);
      setShowForm(false);
      setFormData({});
      showNotification(`Leave allocated successfully for ${selectedYear}`);
    } catch (err) {
      showNotification("Allocation failed", "error");
    }
  };

  // ================= EDIT =================
  const handleEdit = (row) => {
    const allocationMap = {};
    row.leaves.forEach((l) => {
      allocationMap[l.leaveTypeId] = l.allocated;
    });

    setFormData(allocationMap);
    setRemarks(row.remarks || "");
    setEditData(row);
    setShowForm(true);
  };

  // ================= UPDATE =================
  const handleUpdate = async () => {
    try {
      const updatedLeaves = leaveTypes.map((lt) => {
        const existing = editData.leaves.find(
          (l) => l.leaveTypeId.toString() === lt._id.toString()
        );

        return {
          leaveTypeId: lt._id,
          leaveTypeName: lt.name,
          allocated: Number(formData[lt._id] || 0),
          used: existing?.used || 0,
        };
      });

      await fetch("/api/leave-balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: editData._id,
          leaves: updatedLeaves,
          remarks,
        }),
      });

      fetchData(selectedYear);
      setShowForm(false);
      setEditData(null);
      showNotification("Updated successfully");
    } catch {
      showNotification("Update failed", "error");
    }
  };

  // ================= DELETE =================
  const handleDelete = async (row) => {
    if (!confirm(`Delete leave record for ${row.userName}?`)) return;

    await fetch("/api/leave-balances", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _id: row._id }),
    });

    fetchData(selectedYear);
    showNotification("Deleted successfully");
  };

  // ================= FILTER + SORT =================
  const filtered = data.filter((row) =>
    row.userName?.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered];
  if (sortConfig.key) {
    sorted.sort((a, b) => {
      if (a[sortConfig.key] < b[sortConfig.key])
        return sortConfig.direction === "asc" ? -1 : 1;
      if (a[sortConfig.key] > b[sortConfig.key])
        return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }

  const totalPages = Math.ceil(sorted.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginated = sorted.slice(startIndex, startIndex + rowsPerPage);

  const renderPageNumbers = () => {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(
        <button
          key={i}
          onClick={() => setCurrentPage(i)}
          className={`px-2 py-0.5 border rounded text-xs ${
            currentPage === i ? "bg-black text-white" : "bg-white"
          }`}
        >
          {i}
        </button>
      );
    }
    return pages;
  };

  const isBulkAllocationDisabled = !editData && hasBulkAllocationOccurred();

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 p-3 md:p-4 transition-all duration-300 md:ml-64 overflow-x-auto">
        {/* Notification */}
        {notification && (
          <div
            className={`fixed top-4 right-4 z-50 px-3 py-2 rounded-lg shadow-lg text-xs font-medium ${
              notification.type === "error"
                ? "bg-red-500 text-white"
                : "bg-green-500 text-white"
            }`}
          >
            {notification.message}
          </div>
        )}

        {/* Sticky Header with title fixed */}
        <div className="sticky top-0 z-20 bg-gray-100 pt-2 pb-3 -mt-2 mb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg md:text-xl font-bold whitespace-nowrap">Leave Balance List</h1>
              <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-md shadow-sm">
                <label className="text-xs font-medium">Year:</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="border rounded px-1 py-0.5 text-xs bg-white"
                >
                  {[2024, 2025, 2026, 2027, 2028].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!showForm && (
              <button
                onClick={() => {
                  setShowForm(true);
                  setEditData(null);
                  setFormData({});
                  setRemarks("");
                }}
                disabled={isBulkAllocationDisabled}
                className={`flex items-center gap-1 px-2 py-1 bg-white border rounded text-xs font-medium whitespace-nowrap shadow-sm ${
                  isBulkAllocationDisabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:border-black"
                }`}
                title={isBulkAllocationDisabled ? `Bulk allocation already done for ${selectedYear}` : ""}
              >
                <Plus size={12} /> Allocate {selectedYear}
              </button>
            )}
          </div>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white shadow rounded-lg p-4 mb-4 border">
            <h2 className="text-sm font-semibold mb-3">
              {editData ? "Edit Leave Allocation" : `Allocate Leave – ${selectedYear}`}
            </h2>
            {editData && (
              <div className="mb-3 p-2 bg-blue-50 border rounded text-xs">
                Editing: <span className="font-semibold">{editData.userName}</span>
              </div>
            )}
            {!editData && hasBulkAllocationOccurred() && (
              <div className="mb-3 p-2 bg-yellow-50 border rounded text-xs text-yellow-800">
                ⚠️ Bulk allocation already done for {selectedYear}. Edit individual users instead.
              </div>
            )}
            {!editData && !hasBulkAllocationOccurred() && (
              <div className="mb-3 p-2 bg-gray-50 border rounded text-xs">
                ℹ️ Allocates same leave days to ALL users for {selectedYear}. One-time action.
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {leaveTypes.map((lt) => (
                <div key={lt._id}>
                  <label className="text-xs font-medium">{lt.name}</label>
                  <input
                    type="number"
                    value={formData[lt._id] || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, [lt._id]: Number(e.target.value) })
                    }
                    className="w-full border rounded px-2 py-1 text-xs mt-1"
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium">Remarks</label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full border rounded px-2 py-1 text-xs mt-1"
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowForm(false)}
                className="flex items-center gap-1 px-2 py-1 border rounded text-xs"
              >
                <X size={12} /> Cancel
              </button>
              <button
                onClick={editData ? handleUpdate : handleAdd}
                className="flex items-center gap-1 px-2 py-1 border rounded text-xs bg-gray-50"
              >
                {editData ? <Check size={12} /> : <Save size={12} />}
                {editData ? "Update" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search user..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64 px-3 py-1.5 border rounded text-sm"
          />
        </div>

        {/* Responsive Table - horizontal scroll on small screens */}
        <div className="bg-white shadow rounded-lg border overflow-x-auto">
          <table className="min-w-[900px] w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left sticky left-0 bg-gray-50 z-10" rowSpan={2}>#</th>
                <th className="px-2 py-1.5 text-left sticky left-8 bg-gray-50 z-10" rowSpan={2}>User</th>
                {leaveTypes.map(lt => (
                  <th key={lt._id} className="px-1 py-1 text-center" colSpan={3}>{lt.name}</th>
                ))}
                <th className="px-2 py-1.5 text-left" rowSpan={2}>Remarks</th>
                <th className="px-2 py-1.5 text-left sticky right-0 bg-gray-50 z-10" rowSpan={2}>Actions</th>
              </tr>
              <tr>
                {leaveTypes.map(lt => (
                  <React.Fragment key={lt._id}>
                    <th className="px-1 py-0.5 text-center border font-medium">Alloc</th>
                    <th className="px-1 py-0.5 text-center border font-medium">Used</th>
                    <th className="px-1 py-0.5 text-center border font-medium">Bal</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {paginated.map((row, idx) => (
                <tr key={row._id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 sticky left-0 bg-white">{startIndex + idx + 1}</td>
                  <td className="px-2 py-1.5 sticky left-8 bg-white font-medium">{row.userName}</td>
                  {leaveTypes.map(lt => {
                    const leave = row.leaves?.find(l => l.leaveTypeId.toString() === lt._id.toString());
                    const alloc = leave?.allocated || 0;
                    const used = leave?.used || 0;
                    const bal = alloc - used;
                    return (
                      <React.Fragment key={lt._id}>
                        <td className="px-1 py-1.5 text-center border">{alloc}</td>
                        <td className="px-1 py-1.5 text-center border">{used}</td>
                        <td className="px-1 py-1.5 text-center border">{bal}</td>
                      </React.Fragment>
                    );
                  })}
                  <td className="px-2 py-1.5 max-w-[120px] truncate">{row.remarks || "-"}</td>
                  <td className="px-2 py-1.5 sticky right-0 bg-white">
                    <div className="flex gap-1">
                      <button onClick={() => handleEdit(row)} className="p-1 border rounded hover:border-black">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => handleDelete(row)} className="p-1 border rounded hover:border-black">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={leaveTypes.length * 3 + 4} className="text-center py-4 text-gray-500">
                    No data found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap justify-between items-center gap-3 mt-4">
          <div className="flex items-center gap-2 text-xs">
            <span>Rows:</span>
            <select
              value={rowsPerPage}
              onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="border rounded px-1 py-0.5 text-xs"
            >
              {[5, 10, 20, 50].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setCurrentPage(p => Math.max(p-1,1))} disabled={currentPage===1} className="px-2 py-0.5 border rounded text-xs">Prev</button>
            {renderPageNumbers()}
            <button onClick={() => setCurrentPage(p => Math.min(p+1,totalPages))} disabled={currentPage===totalPages || totalPages===0} className="px-2 py-0.5 border rounded text-xs">Next</button>
          </div>
        </div>
      </main>
    </div>
  );
}