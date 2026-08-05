import type { CatalogAudience } from "@/lib/catalog-audiences";

export type AppointmentStatus =
  | "CONFIRMED"
  | "PENDING_PAYMENT"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELED"
  | "NO_SHOW";

export type Appointment = {
  id: string;
  date: string;
  time: string;
  endTime: string;
  customer: string;
  initials: string;
  service: string;
  barber: string;
  barberInitials: string;
  status: AppointmentStatus;
  valueCents: number;
  paidCents: number;
  phone: string;
  source: "PWA" | "Balcão" | "WhatsApp";
};

export type Barber = {
  id: string;
  name: string;
  initials: string;
  role: string;
  specialties: string[];
  appointmentsToday: number;
  nextSlot: string;
  color: string;
  active: boolean;
};

export type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  category: "Cabelo" | "Barba" | "Combos" | "Cuidados";
  active: boolean;
  audiences: CatalogAudience[];
  popular?: boolean;
};

export type DemoPackage = {
  id: string;
  name: string;
  description: string;
  items: number;
  durationMinutes: number;
  listPriceCents: number;
  priceCents: number;
  audiences: CatalogAudience[];
  active: boolean;
  featured: boolean;
};

export type Customer = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  email: string;
  visits: number;
  totalCents: number;
  lastVisit: string;
  nextVisit?: string;
  tags: string[];
};

export const appointments: Appointment[] = [
  {
    id: "AG-1048",
    date: "2026-08-04",
    time: "08:30",
    endTime: "09:15",
    customer: "Rafael Martins",
    initials: "RM",
    service: "Corte clássico",
    barber: "Diego Alves",
    barberInitials: "DA",
    status: "COMPLETED",
    valueCents: 6500,
    paidCents: 6500,
    phone: "+55 11 98814-5021",
    source: "PWA",
  },
  {
    id: "AG-1049",
    date: "2026-08-04",
    time: "09:30",
    endTime: "10:30",
    customer: "Caio Nogueira",
    initials: "CN",
    service: "Corte + barba",
    barber: "Mateus Lima",
    barberInitials: "ML",
    status: "IN_SERVICE",
    valueCents: 10500,
    paidCents: 3000,
    phone: "+55 11 99404-8012",
    source: "WhatsApp",
  },
  {
    id: "AG-1050",
    date: "2026-08-04",
    time: "10:45",
    endTime: "11:30",
    customer: "Bruno Salles",
    initials: "BS",
    service: "Barba premium",
    barber: "Diego Alves",
    barberInitials: "DA",
    status: "CONFIRMED",
    valueCents: 5500,
    paidCents: 5500,
    phone: "+55 11 97732-6204",
    source: "PWA",
  },
  {
    id: "AG-1051",
    date: "2026-08-04",
    time: "11:45",
    endTime: "12:30",
    customer: "Vinícius Rocha",
    initials: "VR",
    service: "Corte degradê",
    barber: "João Victor",
    barberInitials: "JV",
    status: "PENDING_PAYMENT",
    valueCents: 7500,
    paidCents: 0,
    phone: "+55 11 98105-1472",
    source: "Balcão",
  },
  {
    id: "AG-1052",
    date: "2026-08-04",
    time: "14:00",
    endTime: "15:15",
    customer: "Lucas Mendonça",
    initials: "LM",
    service: "Experiência completa",
    barber: "Mateus Lima",
    barberInitials: "ML",
    status: "CONFIRMED",
    valueCents: 14900,
    paidCents: 4500,
    phone: "+55 11 99672-3340",
    source: "PWA",
  },
  {
    id: "AG-1053",
    date: "2026-08-04",
    time: "15:30",
    endTime: "16:15",
    customer: "Henrique Luz",
    initials: "HL",
    service: "Corte clássico",
    barber: "João Victor",
    barberInitials: "JV",
    status: "CONFIRMED",
    valueCents: 6500,
    paidCents: 2000,
    phone: "+55 11 99104-2269",
    source: "PWA",
  },
];

export const barbers: Barber[] = [
  {
    id: "barber-diego",
    name: "Diego Alves",
    initials: "DA",
    role: "Barbeiro sênior",
    specialties: ["Corte clássico", "Barba"],
    appointmentsToday: 6,
    nextSlot: "16:30",
    color: "sage",
    active: true,
  },
  {
    id: "barber-mateus",
    name: "Mateus Lima",
    initials: "ML",
    role: "Barbeiro",
    specialties: ["Degradê", "Combos"],
    appointmentsToday: 5,
    nextSlot: "15:30",
    color: "amber",
    active: true,
  },
  {
    id: "barber-joao",
    name: "João Victor",
    initials: "JV",
    role: "Barbeiro",
    specialties: ["Navalhado", "Pigmentação"],
    appointmentsToday: 4,
    nextSlot: "13:45",
    color: "blue",
    active: true,
  },
];

export const services: Service[] = [
  {
    id: "service-classic",
    name: "Corte clássico",
    description: "Tesoura ou máquina, acabamento e finalização.",
    durationMinutes: 45,
    priceCents: 6500,
    category: "Cabelo",
    active: true,
    audiences: ["MASCULINO"] as CatalogAudience[],
    popular: true,
  },
  {
    id: "service-fade",
    name: "Corte degradê",
    description: "Fade preciso, acabamento na navalha e styling.",
    durationMinutes: 45,
    priceCents: 7500,
    category: "Cabelo",
    active: true,
    audiences: ["MASCULINO"] as CatalogAudience[],
  },
  {
    id: "service-beard",
    name: "Barba premium",
    description: "Toalha quente, desenho, navalha e hidratação.",
    durationMinutes: 45,
    priceCents: 5500,
    category: "Barba",
    active: true,
    audiences: ["MASCULINO"],
  },
  {
    id: "service-brows",
    name: "Acabamento + sobrancelha",
    description: "Contornos, pezinho e limpeza da sobrancelha.",
    durationMinutes: 30,
    priceCents: 3800,
    category: "Cuidados",
    active: true,
    audiences: ["FEMININO", "MASCULINO", "OUTROS_SERVICOS"],
  },
];

export const packages: DemoPackage[] = [
  {
    id: "package-ritual",
    name: "Ritual Los Barberos",
    description: "Corte clássico + barba premium",
    items: 2,
    durationMinutes: 90,
    listPriceCents: 12000,
    priceCents: 10500,
    audiences: ["MASCULINO"],
    active: true,
    featured: true,
  },
  {
    id: "package-complete",
    name: "Experiência completa",
    description: "Corte + barba + sobrancelha + hidratação",
    items: 4,
    durationMinutes: 120,
    listPriceCents: 17100,
    priceCents: 14900,
    audiences: ["MASCULINO", "FEMININO"],
    active: true,
    featured: false,
  },
];

export const customers: Customer[] = [
  {
    id: "customer-rafael",
    name: "Rafael Martins",
    initials: "RM",
    phone: "+55 11 98814-5021",
    email: "rafael.martins@email.com",
    visits: 18,
    totalCents: 128400,
    lastVisit: "Hoje, 08:30",
    nextVisit: "21 ago, 09:00",
    tags: ["Fiel", "PWA"],
  },
  {
    id: "customer-caio",
    name: "Caio Nogueira",
    initials: "CN",
    phone: "+55 11 99404-8012",
    email: "caio.nogueira@email.com",
    visits: 11,
    totalCents: 105500,
    lastVisit: "Hoje, 09:30",
    tags: ["Combo", "WhatsApp"],
  },
  {
    id: "customer-bruno",
    name: "Bruno Salles",
    initials: "BS",
    phone: "+55 11 97732-6204",
    email: "bruno.salles@email.com",
    visits: 8,
    totalCents: 64200,
    lastVisit: "Hoje, 10:45",
    nextVisit: "18 ago, 17:30",
    tags: ["Barba"],
  },
  {
    id: "customer-vinicius",
    name: "Vinícius Rocha",
    initials: "VR",
    phone: "+55 11 98105-1472",
    email: "vinicius.rocha@email.com",
    visits: 5,
    totalCents: 37500,
    lastVisit: "30 jul, 11:00",
    tags: ["Novo"],
  },
  {
    id: "customer-lucas",
    name: "Lucas Mendonça",
    initials: "LM",
    phone: "+55 11 99672-3340",
    email: "lucas.mendonca@email.com",
    visits: 15,
    totalCents: 186900,
    lastVisit: "25 jul, 14:00",
    nextVisit: "Hoje, 14:00",
    tags: ["Fiel", "Premium"],
  },
];

export const weeklyBars = [
  { day: "Seg", value: 42, total: "R$ 620" },
  { day: "Ter", value: 61, total: "R$ 940" },
  { day: "Qua", value: 54, total: "R$ 810" },
  { day: "Qui", value: 72, total: "R$ 1.120" },
  { day: "Sex", value: 86, total: "R$ 1.390" },
  { day: "Sáb", value: 100, total: "R$ 1.780" },
  { day: "Dom", value: 22, total: "R$ 320" },
];

export const financeTransactions = [
  { id: "PAY-8872", label: "Rafael Martins", detail: "Corte clássico", method: "Pix", amountCents: 6500, time: "08:28", status: "Pago" },
  { id: "PAY-8873", label: "Caio Nogueira", detail: "Sinal · Corte + barba", method: "Cartão", amountCents: 3000, time: "09:21", status: "Parcial" },
  { id: "PAY-8874", label: "Bruno Salles", detail: "Barba premium", method: "Pix", amountCents: 5500, time: "10:39", status: "Pago" },
  { id: "PAY-8875", label: "Lucas Mendonça", detail: "Sinal · Experiência completa", method: "Pix", amountCents: 4500, time: "11:06", status: "Parcial" },
];

export const adminOrganizations = [
  { id: "org-01", name: "Los Barberos · Vila Madalena", owner: "Guilherme Castro", plan: "Pro", status: "ACTIVE", mrrCents: 14900, appointments: 486, since: "12 jan 2026" },
  { id: "org-02", name: "Navalha 13", owner: "Rogério Souza", plan: "Pro", status: "TRIALING", mrrCents: 14900, appointments: 71, since: "28 jul 2026" },
  { id: "org-03", name: "Dom Bigode", owner: "André Fernandes", plan: "Essencial", status: "GRACE", mrrCents: 9900, appointments: 309, since: "03 mar 2026" },
  { id: "org-04", name: "Barbearia do Zé", owner: "José Ribeiro", plan: "Essencial", status: "BLOCKED", mrrCents: 9900, appointments: 128, since: "17 abr 2026" },
];

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function getStatusLabel(status: AppointmentStatus) {
  const labels: Record<AppointmentStatus, string> = {
    CONFIRMED: "Confirmado",
    PENDING_PAYMENT: "Pagamento pendente",
    IN_SERVICE: "Em atendimento",
    COMPLETED: "Concluído",
    CANCELED: "Cancelado",
    NO_SHOW: "Não compareceu",
  };

  return labels[status];
}
