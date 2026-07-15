import { Outlet } from "react-router-dom";
import { PlatformNav } from "./PlatformNav";

export function PlatformShell() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PlatformNav />
      <Outlet />
    </div>
  );
}
