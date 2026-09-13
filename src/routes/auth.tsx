import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Crosshair, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — HUNTER 2X" },
      { name: "description", content: "Sign in to the HUNTER 2X Solana trading intelligence terminal." },
      { property: "og:title", content: "Sign in — HUNTER 2X" },
      { property: "og:description", content: "Access your HUNTER 2X strategies, positions and risk controls." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "reset";

function AuthPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await router.invalidate();
        void navigate({ to: "/", replace: true });
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        if (data.session) {
          await router.invalidate();
          void navigate({ to: "/", replace: true });
        } else {
          toast.success("Account created — check your email to confirm it, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        toast.success("Password reset link sent.");
        setMode("signin");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="brand-mark"><Crosshair /></div>
          <div>
            <strong className="font-display text-xl tracking-normal">HUNTER <span className="text-primary">2X</span></strong>
            <p className="text-xs text-muted-foreground">Solana trading intelligence</p>
          </div>
        </div>

        <section className="panel p-6">
          <h1 className="font-display text-lg font-semibold">
            {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "reset"
              ? "We'll email you a link to choose a new password."
              : "Strategies, positions and risk limits are tied to your account."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Hunter" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            {mode !== "reset" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
            </Button>
          </form>

          <div className="mt-5 space-y-2 text-xs">
            {mode !== "signin" && (
              <button className="text-primary hover:underline" onClick={() => setMode("signin")}>Back to sign in</button>
            )}
            {mode === "signin" && (
              <>
                <button className="block text-primary hover:underline" onClick={() => setMode("signup")}>
                  Create an account
                </button>
                <button className="block text-muted-foreground hover:underline" onClick={() => setMode("reset")}>
                  Forgot your password?
                </button>
              </>
            )}
          </div>
        </section>

        <p className="mt-6 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
          Paper execution only · Live execution not configured
        </p>
      </div>
    </main>
  );
}
