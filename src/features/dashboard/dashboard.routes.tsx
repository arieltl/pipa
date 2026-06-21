import { Hono } from "hono";
import { DashboardPage } from "./dashboard.page.tsx";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/", (c) => c.render(<DashboardPage />, { title: "Dashboard" }));
