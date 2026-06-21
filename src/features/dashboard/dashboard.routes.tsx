import { Hono } from "hono";
import { DashboardPage } from "./dashboard.page.tsx";
import { listClients } from "../clients/clients.service.ts";
import {
  clientInvoiceStats,
  listInvoices,
} from "../invoices/invoices.service.ts";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/", (c) =>
  c.render(
    <DashboardPage
      clients={listClients()}
      stats={clientInvoiceStats()}
      recentInvoices={listInvoices().slice(0, 8)}
    />,
    { title: "Overview" },
  ),
);
