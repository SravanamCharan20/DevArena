import Link from "next/link";
import SurfaceCard from "./components/ui/SurfaceCard";

const Homepage = () => {
  return (
    <div className="page-wrap">
      <div className="content-grid lg:grid-cols-[1.15fr_0.85fr]">
        <SurfaceCard className="p-8 sm:p-10 lg:p-12">
          <p className="chip">Live coding platform</p>
          <h1 className="display-title mt-5">
            Minimal interface for serious coding contests.
          </h1>
          <p className="body-muted mt-5 max-w-2xl text-base sm:text-lg">
            Create rooms, invite participants, manage lobby readiness, and start contests
            with synchronized transitions.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/auth/signup" className="btn btn-primary px-4 py-3">
              Get Started
            </Link>
            <Link href="/auth/signin" className="btn btn-secondary px-4 py-3">
              Sign In
            </Link>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-6 sm:p-7">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Room Flow</h2>
            <span className="chip">Preview</span>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3.5">
              <p className="text-sm font-medium">1. Room Created</p>
              <p className="body-muted mt-1 text-sm">Admin creates room and receives code.</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3.5">
              <p className="text-sm font-medium">2. Lobby Ready Check</p>
              <p className="body-muted mt-1 text-sm">Members join and toggle ready status.</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3.5">
              <p className="text-sm font-medium">3. Contest Starts</p>
              <p className="body-muted mt-1 text-sm">Synchronized countdown moves everyone to arena.</p>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
};

export default Homepage;
