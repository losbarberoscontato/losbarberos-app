import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/entrar?modo=login&next=%2Fdisplay-admin");
}
