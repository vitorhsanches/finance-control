import type { Page, Route } from "@playwright/test";

type MockOptions = {
  writeDelay?: number;
};

const user = {
  id: "e2e-user",
  aud: "authenticated",
  role: "authenticated",
  email: "user@example.com",
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
};

const session = {
  access_token: "e2e-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "e2e-refresh-token",
  user,
};

const settings = {
  user_id: user.id,
  currency: "BRL",
  selected_month: "2026-07",
  starting_balance: 1000,
  monthly_income_estimate: 5000,
  monthly_saving_goal: 500,
  emergency_contribution: 100,
};

export async function mockSupabase(page: Page, options: MockOptions = {}) {
  const requests: Array<{ method: string; url: string }> = [];

  await page.route("**/__supabase/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), url: url.pathname });

    if (url.pathname.endsWith("/auth/v1/token")) {
      const credentials = request.postDataJSON() as { email?: string } | null;
      if (credentials?.email === "failure@example.com") {
        await json(route, { code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
        return;
      }
      await json(route, session);
      return;
    }

    if (url.pathname.endsWith("/auth/v1/user")) {
      await json(route, user);
      return;
    }

    if (url.pathname.endsWith("/auth/v1/logout")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname.includes("/rest/v1/")) {
      await handleRest(route, url, options.writeDelay || 0);
      return;
    }

    await json(route, {});
  });

  return { requests };
}

async function handleRest(route: Route, url: URL, writeDelay: number) {
  const request = route.request();
  const table = url.pathname.split("/rest/v1/")[1];

  if (request.method() === "HEAD") {
    await route.fulfill({ status: 200, headers: { "content-range": "*/0" }, body: "" });
    return;
  }

  if (request.method() !== "GET") {
    if (writeDelay && table === "app_settings") {
      await new Promise((resolve) => setTimeout(resolve, writeDelay));
    }
    await route.fulfill({ status: request.method() === "DELETE" ? 204 : 201, body: "" });
    return;
  }

  if (table === "app_settings") {
    await json(route, settings);
  } else if (table === "profiles") {
    await json(route, { display_name: "Pessoa E2E" });
  } else if (table === "categories") {
    await json(route, [
      { kind: "expense", name: "Alimentação", sort_order: 0 },
      { kind: "expense", name: "Lazer", sort_order: 1 },
      { kind: "income", name: "Salário", sort_order: 0 },
    ]);
  } else if (table === "accounts") {
    await json(route, [{ name: "Conta E2E", sort_order: 0 }]);
  } else if (table === "cards") {
    await json(route, [{ name: "Cartão E2E", sort_order: 0 }]);
  } else if (table === "payment_methods") {
    await json(route, [{ name: "Pix", sort_order: 0 }]);
  } else if (table === "card_rules") {
    await json(route, [{ card_name: "Cartão E2E", closing_day: 5, due_day: 12 }]);
  } else {
    await json(route, []);
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
