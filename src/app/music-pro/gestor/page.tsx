import { redirect } from "next/navigation";

export default function MusicProManagerEntry() {
  redirect("/music-pro/entrar?modo=login&next=%2Fgestor");
}
