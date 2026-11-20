-- Mobile number confirmed by OTP before a PIN may be entered.
ALTER TABLE "login_sessions" ADD COLUMN "otp_verified_at" TIMESTAMP(3);
