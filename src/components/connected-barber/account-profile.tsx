"use client";

import { useRef, useState, type FormEvent } from "react";
import { Camera } from "lucide-react";
import { normalizePhoneE164 } from "@/lib/phone";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { BarberAccountProfile } from "./types";
import styles from "./access.module.css";

export function BarberAccountProfileForm({ profile, email }: { profile: BarberAccountProfile; email: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function uploadPhoto(file: File) {
    if (!/^image\/(png|jpeg|webp)$/u.test(file.type) || file.size > 2 * 1024 * 1024) {
      throw new Error("Use PNG, JPEG ou WebP de até 2 MB.");
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error("Sistema indisponível neste ambiente.");
    const path = `${profile.id}/${crypto.randomUUID()}.webp`;
    const { error } = await supabase.storage.from("profile-avatars").upload(path, file, {
      contentType: file.type,
      cacheControl: "31536000",
    });
    if (error) throw error;
    return supabase.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const data = new FormData(event.currentTarget);
      const rawPhone = String(data.get("phone_e164") ?? "").trim();
      const phone = normalizePhoneE164(rawPhone);
      if (rawPhone && !phone) throw new Error("Informe um WhatsApp válido.");
      const avatar = data.get("avatar");
      const nextAvatar = avatar instanceof File && avatar.size > 0 ? await uploadPhoto(avatar) : avatarUrl;
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Sistema indisponível neste ambiente.");
      const { error } = await supabase.from("profiles").upsert({
        id: profile.id,
        display_name: String(data.get("display_name") ?? "").trim() || null,
        phone_e164: phone,
        bio: String(data.get("bio") ?? "").trim() || null,
        avatar_url: nextAvatar,
      }, { onConflict: "id" });
      if (error) throw error;
      setAvatarUrl(nextAvatar);
      setMessage("Perfil atualizado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o perfil.");
    } finally {
      setSaving(false);
    }
  }

  const initials = (profile.display_name || email || "B").trim().slice(0, 1).toUpperCase();
  return (
    <form className={styles.profileForm} onSubmit={save}>
      <div className={styles.profileIdentity}>
        <span
          className={styles.profileAvatar}
          role="img"
          aria-label={avatarUrl ? "Foto de perfil" : "Sem foto de perfil"}
          style={avatarUrl ? { backgroundImage: `url(${JSON.stringify(avatarUrl)})` } : undefined}
        >
          {!avatarUrl && initials}
        </span>
        <div>
          <strong>Meu perfil</strong>
          <span>{email ?? "Conta do Barbeiro"}</span>
        </div>
        <button className={styles.photoButton} type="button" onClick={() => input.current?.click()}>
          <Camera size={16} /> Trocar foto
        </button>
        <input ref={input} name="avatar" type="file" accept="image/png,image/jpeg,image/webp" hidden />
      </div>
      {message && <p className={styles.notice} role="status">{message}</p>}
      <label>
        Nome
        <input name="display_name" defaultValue={profile.display_name ?? ""} minLength={2} />
      </label>
      <label>
        WhatsApp
        <input name="phone_e164" defaultValue={profile.phone_e164 ?? ""} inputMode="tel" placeholder="+5547999999999" />
      </label>
      <label>
        Descrição de perfil
        <textarea name="bio" defaultValue={profile.bio ?? ""} maxLength={1000} />
      </label>
      <button className={styles.profileSubmit} type="submit" disabled={saving}>
        {saving ? "Salvando..." : "Salvar perfil"}
      </button>
    </form>
  );
}
