import { Outlet } from "react-router-dom";
import { PlatformNav } from "./PlatformNav";

export function PlatformShell() {
  return (
    <div className="flex min-h-screen bg-page">
      <PlatformNav />
      <main className="flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
