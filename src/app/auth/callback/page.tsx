import { redirect } from "next/navigation";
// Legacy Wix callback is retired. Native Google uses the server API callback.
export default function Page() { redirect("/login"); }
