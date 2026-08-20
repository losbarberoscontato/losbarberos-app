"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  claimMyExistingCustomer,
  getMyClientAccount,
  getMyCustomer,
  getPublicBookingOrganization,
  getPublicBookingContext,
  linkMyClientToOrganization,
  listMyClientOrganizations,
  setMyLastClientOrganization,
  toClientError,
} from "@/components/connected-client/api";
import { normalizeTenantSlug, resolveTenantSlug, tenantStorageKey } from "@/components/connected-client/format";
import type {
  ClientClaimResult,
  ClientLinkResult,
  ConnectedClientState,
  Customer,
} from "@/components/connected-client/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type ClientTenantLinkResult = ClientLinkResult | ClientClaimResult;

type PendingClaim = {
  customerId: string;
  organizationId: string;
  slug: string;
};

type ConnectedClientContextValue = ConnectedClientState & {
  selectTenant: (slug: string) => void;
  switchTenant: (slug: string) => void;
  reloadCustomer: () => Promise<Customer | null>;
  confirmTenantLink: () => Promise<ClientTenantLinkResult>;
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

function queryBookingId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("booking")
    ?? window.sessionStorage.getItem("los-barberos:pending-booking");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value) ? value : null;
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
  const [account, setAccount] = useState<ConnectedClientState["account"]>(null);
  const [organizations, setOrganizations] = useState<ConnectedClientState["organizations"]>([]);
  const [linkStatus, setLinkStatus] = useState<ConnectedClientState["linkStatus"]>("IDLE");
  const [pendingClaim, setPendingClaim] = useState<PendingClaim | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentSlugRef = useRef(slug);
  const linkInFlightRef = useRef<{ slug: string; promise: Promise<ClientTenantLinkResult> } | null>(null);
  const bookingAutoLinkRef = useRef<string | null>(null);
  const autoTenantResolvedRef = useRef(false);
  const lastTenantSyncRef = useRef<string | null>(null);

  useEffect(() => {
    currentSlugRef.current = slug;
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    let active = true;
    const resolve = async () => {
      const bookingId = queryBookingId();
      const direct = resolveTenantSlug(queryTenant(), null, initialSlug);
      if (direct) {
        if (active) setSlug(direct);
        return;
      }
      if (bookingId && supabase) {
        window.sessionStorage.setItem("los-barberos:pending-booking", bookingId);
        try {
          const organization = await getPublicBookingOrganization(supabase, bookingId);
          if (active && organization) setSlug(organization.slug);
          else if (active) setLoading(false);
        } catch {
          if (active) setLoading(false);
        }
        return;
      }
      if (active) setLoading(false);
    };
    void resolve();
    return () => { active = false; };
  }, [initialSlug, slug, supabase]);

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
      setPendingClaim(null);
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

  useEffect(() => {
    if (!supabase || !user) {
      queueMicrotask(() => {
        setAccount(null);
        setOrganizations([]);
        setCustomer(null);
        setPendingClaim(null);
        setLinkStatus("IDLE");
        if (!user) setAuthLoading(false);
      });
      return;
    }
    let active = true;
    const expectedUserId = user.id;
    queueMicrotask(() => {
      if (!active) return;
      setAuthLoading(true);
      setLinkStatus("LOADING");
      setCustomer(null);
      setPendingClaim(null);
    });
    void (async () => {
      const nextAccount = await getMyClientAccount(supabase, expectedUserId);
      if (!nextAccount) throw new Error("Conta global de cliente não encontrada.");
      const nextOrganizations = await listMyClientOrganizations(supabase);
      if (!active) return;

      const relation = context
        ? nextOrganizations.find((item) =>
            item.organization_id === context.organization.id
            && item.organization_slug === context.organization.slug)
        : null;
      let nextCustomer: Customer | null = null;
      if (context && relation) {
        nextCustomer = await getMyCustomer(supabase, context.organization.id, expectedUserId);
        if (!nextCustomer || nextCustomer.id !== relation.customer_id) {
          throw new Error("Relação de cliente inconsistente para esta barbearia.");
        }
      }
      if (!active) return;
      setAccount(nextAccount);
      setOrganizations(nextOrganizations);
      setCustomer(nextCustomer);
      setLinkStatus(context ? (relation ? "LINKED" : "UNLINKED") : "IDLE");
    })().catch((cause: unknown) => {
      if (!active) return;
      setAccount(null);
      setOrganizations([]);
      setCustomer(null);
      setLinkStatus("ERROR");
      setError(toClientError(cause, "Não foi possível carregar conta do cliente."));
    }).finally(() => {
      if (active) setAuthLoading(false);
    });
    return () => {
      active = false;
    };
  }, [context, supabase, user]);

  useEffect(() => {
    if (
      slug
      || !user
      || authLoading
      || organizations.length === 0
      || autoTenantResolvedRef.current
      || queryTenant()
      || normalizeTenantSlug(initialSlug)
    ) return;

    const stored = readStoredTenant();
    const target = organizations.find((item) => item.is_last)
      ?? organizations.find((item) => item.organization_slug === stored)
      ?? organizations[0];
    if (!target) return;

    autoTenantResolvedRef.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) setSlug(target.organization_slug);
    });
    return () => {
      active = false;
    };
  }, [authLoading, initialSlug, organizations, slug, user]);

  useEffect(() => {
    if (!supabase || !user || !context) return;
    const relation = organizations.find((item) =>
      item.organization_id === context.organization.id
      && item.organization_slug === context.organization.slug,
    );
    if (!relation || relation.is_last || lastTenantSyncRef.current === relation.organization_slug) return;

    lastTenantSyncRef.current = relation.organization_slug;
    void setMyLastClientOrganization(supabase, relation.organization_slug).catch(() => {
      // Older deployments may not yet contain the additive preference RPC.
    });
  }, [context, organizations, supabase, user]);

  const reloadCustomer = useCallback(async (): Promise<Customer | null> => {
    if (!supabase || !context || !user) {
      setCustomer(null);
      return null;
    }
    const relation = organizations.find((item) =>
      item.organization_id === context.organization.id
      && item.organization_slug === context.organization.slug);
    if (!relation) {
      setCustomer(null);
      return null;
    }
    const result = await getMyCustomer(supabase, context.organization.id, user.id);
    if (!result || result.id !== relation.customer_id) {
      setCustomer(null);
      throw new Error("Relação de cliente inconsistente para esta barbearia.");
    }
    setCustomer(result);
    return result;
  }, [context, organizations, supabase, user]);

  const selectTenant = useCallback((value: string) => {
    if (!value.trim()) {
      setSlug(null);
      setContext(null);
      setCustomer(null);
      setPendingClaim(null);
      setLinkStatus("IDLE");
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
    setPendingClaim(null);
    setLinkStatus(user ? "LOADING" : "IDLE");
    setSlug(normalized);
    const url = new URL(window.location.href);
    url.searchParams.set("barbearia", normalized);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [user]);

  const switchTenant = useCallback((value: string) => {
    selectTenant(value);
  }, [selectTenant]);

  const confirmTenantLink = useCallback((): Promise<ClientTenantLinkResult> => {
    if (!supabase || !user || !slug || !context) {
      return Promise.reject(new Error("Sessão e barbearia são obrigatórias para criar vínculo."));
    }
    if (linkInFlightRef.current?.slug === slug) return linkInFlightRef.current.promise;

    const expectedSlug = slug;
    const expectedOrganizationId = context.organization.id;
    const claim = pendingClaim?.slug === expectedSlug
      && pendingClaim.organizationId === expectedOrganizationId
      ? pendingClaim
      : null;
    setLinkStatus("LINKING");
    setError(null);
    const operation = (async () => {
      try {
        const result = claim
          ? await claimMyExistingCustomer(supabase, claim.organizationId, claim.customerId)
          : await linkMyClientToOrganization(supabase, expectedSlug, expectedOrganizationId);

        if (claim) {
          if (
            result.organization_id !== expectedOrganizationId
            || result.customer_id !== claim.customerId
          ) {
            throw new Error("Resposta de confirmação não corresponde ao cadastro selecionado.");
          }
        } else {
          if (
            !("organization_slug" in result)
            || result.organization_id !== expectedOrganizationId
            || result.organization_slug !== expectedSlug
          ) {
            throw new Error("Resposta de vínculo não corresponde à barbearia selecionada.");
          }
        }
        if (currentSlugRef.current !== expectedSlug) return result;

        if (!claim && result.status === "CLAIM_REQUIRED") {
          if (!result.customer_id) throw new Error("Cadastro encontrado sem identificador de cliente.");
          setCustomer(null);
          setPendingClaim({
            customerId: result.customer_id,
            organizationId: expectedOrganizationId,
            slug: expectedSlug,
          });
          setLinkStatus("CLAIM_REQUIRED");
          return result;
        }
        if (result.status === "REVIEW_REQUIRED") {
          setCustomer(null);
          setPendingClaim(null);
          setLinkStatus("REVIEW_REQUIRED");
          return result;
        }
        if (!result.customer_id) throw new Error("Vínculo confirmado sem cliente tenant.");

        const nextOrganizations = await listMyClientOrganizations(supabase);
        const relation = nextOrganizations.find((item) =>
          item.organization_id === expectedOrganizationId
          && item.organization_slug === expectedSlug
          && item.customer_id === result.customer_id);
        if (!relation) throw new Error("Vínculo confirmado não apareceu na lista de barbearias.");
        const nextCustomer = await getMyCustomer(supabase, expectedOrganizationId, user.id);
        if (!nextCustomer || nextCustomer.id !== relation.customer_id) {
          throw new Error("Relação de cliente inconsistente para esta barbearia.");
        }
        if (currentSlugRef.current !== expectedSlug) return result;
        setOrganizations(nextOrganizations);
        setCustomer(nextCustomer);
        setPendingClaim(null);
        setLinkStatus("LINKED");
        return result;
      } catch (cause: unknown) {
        if (currentSlugRef.current === expectedSlug) {
          setCustomer(null);
          setPendingClaim(null);
          setLinkStatus("ERROR");
          setError(toClientError(cause, "Não foi possível entrar nesta barbearia."));
        }
        throw cause;
      }
    })();
    const guarded = operation.then(
      (result) => {
        if (linkInFlightRef.current?.promise === guarded) linkInFlightRef.current = null;
        return result;
      },
      (cause: unknown) => {
        if (linkInFlightRef.current?.promise === guarded) linkInFlightRef.current = null;
        throw cause;
      },
    );
    linkInFlightRef.current = { slug: expectedSlug, promise: guarded };
    return guarded;
  }, [context, pendingClaim, slug, supabase, user]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw new Error(signOutError.message);
    setUser(null);
    setAccount(null);
    setOrganizations([]);
    setCustomer(null);
    setPendingClaim(null);
    setLinkStatus("IDLE");
    window.sessionStorage.removeItem("los-barberos:pending-booking");
  }, [supabase]);

  useEffect(() => {
    const bookingId = queryBookingId();
    if (!bookingId || !user || !context || organizations.length > 0 || linkStatus !== "UNLINKED") return;
    if (bookingAutoLinkRef.current === context.organization.slug) return;
    bookingAutoLinkRef.current = context.organization.slug;
    void confirmTenantLink().then(() => {
      window.sessionStorage.removeItem("los-barberos:pending-booking");
    }).catch(() => {
      bookingAutoLinkRef.current = null;
    });
  }, [confirmTenantLink, context, linkStatus, organizations.length, user]);

  const value = useMemo<ConnectedClientContextValue>(() => ({
    slug,
    context,
    user,
    account,
    organizations,
    linkStatus,
    customer,
    loading,
    authLoading,
    error,
    selectTenant,
    switchTenant,
    reloadCustomer,
    confirmTenantLink,
    signOut,
  }), [account, authLoading, confirmTenantLink, context, customer, error, linkStatus, loading, organizations, reloadCustomer, selectTenant, signOut, slug, switchTenant, user]);

  return <ConnectedClientContext.Provider value={value}>{children}</ConnectedClientContext.Provider>;
}

export function useConnectedClient(): ConnectedClientContextValue {
  const value = useContext(ConnectedClientContext);
  if (!value) throw new Error("useConnectedClient requires ConnectedClientProvider");
  return value;
}
