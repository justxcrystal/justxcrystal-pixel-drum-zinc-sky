import { useEffect, useState, type FormEvent } from "react";
import { Activity, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadRememberedLogin, useDesk } from "@/lib/desk/store";

const SERVER = "ATLAS";

export function ConnectPanel() {
  const connectTl = useDesk((s) => s.connectTl);
  const skipToPaper = useDesk((s) => s.skipToPaper);
  const busy = useDesk((s) => s.loginBusy);
  const error = useDesk((s) => s.loginError);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const saved = loadRememberedLogin();
    if (saved?.email) setEmail(saved.email);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (!em || !password) {
      useDesk.setState({ loginError: "Email and password. Server is ATLAS." });
      return;
    }
    await connectTl({
      email: em,
      password,
      server: SERVER,
      env: "demo",
      remember: true,
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-3xl bg-surface px-5 py-5 shadow-border">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-surface-2 shadow-border">
          <Activity className="size-4 text-primary" strokeWidth={2.2} />
        </div>
        <div>
          <p className="font-mono text-2xs tracking-label text-faint uppercase">Sign in on this desk</p>
          <h2 className="text-base font-semibold leading-tight">Connect DEMO</h2>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Stays on this screen. Server ATLAS. Email and password from Atlas — this does not open TradeLocker.
      </p>
      <label className="mt-4 block">
        <span className="mb-2 block font-mono text-2xs tracking-label text-faint uppercase">Email</span>
        <Input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <div className="mt-3">
        <span className="mb-2 block font-mono text-2xs tracking-label text-faint uppercase">Password</span>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-faint"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-surface-2 px-4 py-3 shadow-border">
        <p className="font-mono text-2xs tracking-label text-faint uppercase">Server</p>
        <p className="mt-1 text-sm font-semibold tracking-wide">ATLAS</p>
      </div>
      {error ? (
        <p className="mt-3 text-sm leading-relaxed text-loss" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="mt-4 w-full" disabled={busy} size="lg">
        {busy ? "Signing in…" : "Connect DEMO"}
      </Button>
      <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => skipToPaper()}>
        Paper desk — no Atlas
      </Button>
    </form>
  );
}
