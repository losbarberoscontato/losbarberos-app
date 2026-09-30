import { redirect } from "next/navigation";

export default function ProSteticManagerEntry() {
  redirect("/pro-stetic/entrar?modo=login&next=%2Fgestor");
}
