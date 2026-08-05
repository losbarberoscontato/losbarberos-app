"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMyCustomer, getPublicBookingContext, toClientError } from "@/components/connected-client/api";
import { normalizeTenantSlug, resolveTenantSlug, tenantStorageKey } from "@/components/connected-client/format";
import type { ConnectedClientState, Customer } from "@/components/connected-client/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type ConnectedClientContextValue = ConnectedClientState & {
  selectTenant: (slug: string) => void;
  reloadCustomer: () => Promise<Customer | null>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const ConnectedClientContext = createContext<ConnectedClientContextValue | null>(null);

function readStoredTenant(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(tenantStorageKey) ?? window.sessionStorage.getItem(tenantStorageKey);
}

function queryTenant(): string | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  return query.get("barbearia") ?? query.get("tenant") ?? query.get("slug");
}

export function ConnectedClientProvider({
  children,
  initialSlug = null,
}: {
  children: React.ReactNode;
  initialSlug?: string | null;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [slug, setSlug] = useState<string | null>(() => normalizeTenantSlug(initialSlug));
  const [context, setContext] = useState<ConnectedClientState["context"]>(null);
  const [user, setUser] = useState<User | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (slug) return;
    queueMicrotask(() => {
      const resolved = resolveTenantSlug(queryTenant(), readStoredTenant(), initialSlug);
      setSlug(resolved);
      if (!resolved) setLoading(false);
    });
  }, [initialSlug, slug]);

  useEffect(() => {
    if (!slug || !supabase) {
      if (!supabase) {
        queueMicrotask(() => {
          setError("Supabase não configurado.");
          setLoading(false);
          setAuthLoading(false);
        });
      }
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
      setCustomer(null);
      window.localStorage.setItem(tenantStorageKey, slug);
      window.sessionStorage.setItem(tenantStorageKey, slug);
    });
    void getPublicBookingContext(supabase, slug)
      .then((result) => {
        if (!active) return;
        setContext(result);
        setCustomer((current) =>
          current?.organization_id === result?.organization.id ? current : null
        );
        if (!result) setError("Barbearia não encontrada.");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setContext(null);
        setError(toClientError(cause, "Não foi possível carregar barbearia."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, supabase]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser((current) => current?.id === data.user?.id ? current : data.user ?? null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setUser((current) => event === "USER_UPDATED" || current?.id !== session?.user?.id
        ? session?.user ?? null
        : current);
      setCustomer((current) => session?.user && current?.auth_user_id === session.user.id ? current : null);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const reloadCustomer = useCallback(async (): Promise<Customer | null> => {
    if (!supabase || !context || !user) {
      setCustomer(null);
      return null;
    }
    const result = await getMyCustomer(supabase, context.organization.id, user.id);
    setCustomer(result);
    return result;
  }, [context, supabase, user]);

  useEffect(() => {
    if (!context || !user) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAuthLoading(true);
      void reloadCustomer().catch((cause: unknown) => {
        if (active) setError(toClientError(cause, "Não foi possível carregar perfil."));
      }).finally(() => {
        if (active) setAuthLoading(false);
      });
    });
    return () => { active = false; };
  }, [context, reloadCustomer, user]);

  const selectTenant = useCallback((value: string) => {
    if (!value.trim()) {
      setSlug(null);
      setContext(null);
      setCustomer(null);
      setError(null);
      setLoading(false);
      window.localStorage.removeItem(tenantStorageKey);
      window.sessionStorage.removeItem(tenantStorageKey);
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    const normalized = normalizeTenantSlug(value);
    setError(normalized ? null : "Slug inválido.");
    if (!normalized) return;
    setContext(null);
    setCustomer(null);
    setSlug(normalized);
    const url = new URL(window.location.href);
    url.searchParams.set("barbearia", normalized);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase || !slug) return;
    window.localStorage.setItem(tenantStorageKey, slug);
    window.sessionStorage.setItem(tenantStorageKey, slug);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/cliente/agendar")}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) throw new Error(oauthError.message);
  }, [slug, supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw new Error(signOutError.message);
    setUser(null);
    setCustomer(null);
  }, [supabase]);

  const value = useMemo<ConnectedClientContextValue>(() => ({
    slug,
    context,
    user,
    customer,
    loading,
    authLoading,
    error,
    selectTenant,
    reloadCustomer,
    signInWithGoogle,
    signOut,
  }), [authLoading, context, customer, error, loading, reloadCustomer, selectTenant, signInWithGoogle, signOut, slug, user]);

  return <ConnectedClientContext.Provider value={value}>{children}</ConnectedClientContext.Provider>;
}

export function useConnectedClient(): ConnectedClientContextValue {
  const value = useContext(ConnectedClientContext);
  if (!value) throw new Error("useConnectedClient requires ConnectedClientProvider");
  return value;
}
