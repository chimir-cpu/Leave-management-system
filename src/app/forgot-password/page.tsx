"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState<"email" | "reset">("email");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(data.message);
        setStep("reset");
      } else {
        setError(data.error || "Failed to send reset code");
      }
    } catch (err) {
      setError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, newPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(data.message);
        setTimeout(() => {
          router.push("/login");
        }, 2000);
      } else {
        setError(data.error || "Failed to reset password");
      }
    } catch (err) {
      setError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage("New code sent to your email!");
      } else {
        setError(data.error || "Failed to resend code");
      }
    } catch (err) {
      setError("Server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
<div className="min-h-screen flex items-center justify-center bg-[#00083d]">
  <div className="bg-white shadow-2xl border border-gray-200 rounded-3xl p-10 w-full max-w-md">

    {/* Header */}

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">
            {step === "email" ? "Forgot Password" : "Reset Password"}
          </h1>
          <p className="text-gray-500 mt-1">
            {step === "email"
              ? "Enter your email to receive a reset code"
              : "Enter the code sent to your email"}
          </p>
        </div>

        {/* Step 1: Email Input */}
        {step === "email" && (
          <form className="flex flex-col gap-4" onSubmit={handleSendOTP}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
              className="p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00083d] transition"
            />
            <button
              type="submit"
              disabled={loading}
              className="p-3 bg-[#00083d] text-white rounded-xl font-semibold hover:bg-[#00083d]/90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Sending..." : "Send Reset Code"}
            </button>
          </form>
        )}

        {/* Step 2: OTP and New Password */}
        {step === "reset" && (
          <form className="flex flex-col gap-4" onSubmit={handleResetPassword}>
            <input
              type="text"
              placeholder="Enter 6-digit code"
              value={otp}
              required
              maxLength={6}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00083d] transition text-center text-2xl tracking-widest font-bold"
            />
            <input
              type="password"
              placeholder="New Password"
              value={newPassword}
              required
              onChange={(e) => setNewPassword(e.target.value)}
              className="p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00083d] transition"
            />
            <input
              type="password"
              placeholder="Confirm New Password"
              value={confirmPassword}
              required
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00083d] transition"
            />
            <button
              type="submit"
              disabled={loading}
              className="p-3 bg-[#00083d] text-white rounded-xl font-semibold hover:bg-[#00083d]/90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Resetting..." : "Reset Password"}
            </button>

            {/* Resend OTP */}
            <button
              type="button"
              onClick={handleResendOTP}
              disabled={loading}
              className="text-sm text-[#00083d] hover:underline disabled:opacity-50"
            >
              Didn't receive code? Resend
            </button>

            {/* Back to email step */}
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setOtp("");
                setNewPassword("");
                setConfirmPassword("");
                setError("");
                setMessage("");
              }}
              className="text-sm text-gray-500 hover:underline"
            >
              Use different email
            </button>
          </form>
        )}

        {/* Success message */}
        {message && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
            {message}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Back to login */}
        <p className="text-center mt-6 text-sm text-gray-500">
          Remember your password?{" "}
          <a href="/login" className="text-[#00083d] hover:underline">
            Back to Login
          </a>
        </p>
      </div>
    </div>
  );
}
