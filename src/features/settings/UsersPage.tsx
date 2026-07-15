import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function UsersPage() {
  const { data: users } = useQuery({
    queryKey: ["tenant-users"],
    queryFn: async () => (await supabase.from("users").select("id, full_name, email, role, locale").order("full_name")).data ?? [],
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Users</h1>
      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full text-sm">
          <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Locale</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium">{u.full_name}</td>
                <td className="px-4 py-2 text-ink-faint">{u.email}</td>
                <td className="px-4 py-2 capitalize">{u.role.replace("_", " ")}</td>
                <td className="px-4 py-2 uppercase">{u.locale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
