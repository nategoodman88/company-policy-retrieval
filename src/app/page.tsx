"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sign in failed.");
      window.location.assign("/chat");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-identity" aria-label="COMPANY">
        <div className="brand-lockup">
          <span>COMPANY</span>
        </div>
        <div className="identity-copy">
          <h1>Get clarity on<br />company policy.</h1>
          <div className="identity-rule" />
          <div className="identity-foot">
            <span className="identity-version">v 0.1</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="form-heading">
            <h2>Welcome back</h2>
            <p>Sign in with your COMPANY credentials.</p>
          </div>
          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <div className="password-label-row">
              <label htmlFor="password">Password</label>
              <LockKeyhole size={13} aria-hidden="true" />
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="sign-in-button" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? "Logging in..." : "Log in"}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
          <div className="secure-note">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Protected COMPANY access</span>
          </div>
        </div>
      </section>
    </main>
  );
}