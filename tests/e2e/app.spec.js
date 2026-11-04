import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  let session = {
      id: "session-one",
      title: "새로운 생각",
      revision: 0,
      status: "active",
      busy: false,
    },
    messages = [],
    edges = [],
    run = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    let data = {};
    try {
      data = request.postDataJSON() ?? {};
    } catch {}
    let output = {};
    if (path === "/api/config")
      output = {
        model: "fixed:free",
        modelConfigured: true,
        keyConfigured: true,
        searchEnabled: true,
      };
    else if (path === "/api/usage")
      output = {
        appAttempts: 2,
        providerRemainingCalls: null,
        creditRemaining: 10,
      };
    else if (path === "/api/sessions")
      output = method === "POST" ? session : [session];
    else if (path.endsWith("/messages") && method === "POST") {
      messages.push(
        {
          id: "u" + messages.length,
          role: "user",
          content: data.content,
          mode: "dialogue",
          position: messages.length,
        },
        {
          id: "a" + messages.length,
          role: "assistant",
          content: "어떤 경험에서 그렇게 느꼈나요?",
          mode: "dialogue",
          position: messages.length + 1,
        },
      );
      session = {
        ...session,
        revision: session.revision + 2,
        title: messages[0].content,
      };
      output = { session, messages };
    } else if (path.endsWith("/impact"))
      output = {
        revision: session.revision,
        affected: { messages: messages.length - 1, research: 0, relations: 0 },
      };
    else if (path.includes("/messages/") && method === "PATCH") {
      messages = [{ ...messages[0], content: data.content }];
      session = { ...session, revision: session.revision + 1 };
      output = { session, messages };
    } else if (path.endsWith("/regenerate")) {
      messages.at(-1).content = "그 경험은 어떤 의미였나요?";
      session = { ...session, revision: session.revision + 1 };
      output = { session, messages };
    } else if (path.endsWith("/status")) {
      session = {
        ...session,
        status: data.status,
        revision: session.revision + 1,
      };
      output = { session, messages };
    } else if (path.endsWith("/graph") || path.endsWith("/graph/refresh"))
      output = { nodes: messages.filter((m) => m.role === "user"), edges };
    else if (path.endsWith("/research") && method === "GET")
      output = run ? [run] : [];
    else if (path.endsWith("/research") && method === "POST") {
      run = {
        id: "r1",
        sessionId: session.id,
        declaration: data.declaration,
        status: "pending",
        revision: 0,
        steps: [],
      };
      output = run;
    } else if (path.includes("/research/r1")) {
      if (path.endsWith("/advance")) {
        if (!run.steps.length)
          run = {
            ...run,
            status: "ready",
            revision: 2,
            steps: [
              {
                id: "step1",
                position: 0,
                question: "실제 업무는?",
                status: "pending",
                sources: [],
                uncertainties: [],
              },
            ],
          };
        else if (run.steps[0].status === "pending")
          run = {
            ...run,
            revision: 4,
            steps: [
              {
                ...run.steps[0],
                status: "completed",
                result: "실제 업무 자료",
                sources: [
                  { id: "src", title: "공식 자료", url: "https://example.org" },
                ],
              },
            ],
          };
        else
          run = {
            ...run,
            status: "completed",
            revision: 6,
            result: {
              answer: "조사 결과",
              uncertainties: [],
              sourceIds: ["src"],
            },
          };
      }
      output = run;
    } else if (path === "/api/sessions/session-one")
      output = { session, messages };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(output),
    });
  });
});
test("conversation, review, pause and reload preserve visible history", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "생각의 시작은, 작은 질문 하나." }),
  ).toBeVisible();
  await page.getByLabel("내 생각 입력").fill("진로를 고르기 어려워");
  await page.getByRole("button", { name: "생각 보내기" }).click();
  await expect(page.getByText("어떤 경험에서 그렇게 느꼈나요?")).toBeVisible();
  await page.getByRole("button", { name: "내 발언" }).click();
  await expect(
    page.getByRole("heading", { name: "내 발언 돌아보기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "잠시 멈추기" }).click();
  await expect(page.getByRole("button", { name: "문답 재개" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("진로를 고르기 어려워").first()).toBeVisible();
});
test("editing requires impact confirmation; regeneration remains in context", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("내 생각 입력").fill("첫 생각");
  await page.getByRole("button", { name: "생각 보내기" }).click();
  await expect(page.getByText("어떤 경험에서 그렇게 느꼈나요?")).toBeVisible();
  await page.getByRole("button", { name: "질문 다시 생성" }).click();
  await expect(page.getByText("그 경험은 어떤 의미였나요?")).toBeVisible();
  await page.getByRole("button", { name: "발언 수정" }).click();
  await page.getByLabel("발언 수정 내용").fill("수정한 생각");
  await page.getByRole("button", { name: "수정 적용" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByText("그 경험은 어떤 의미였나요?")).toBeVisible();
});
test("explicit declaration drives research and can return to dialogue", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "탐색", exact: true }).click();
  await page.getByLabel("탐색할 내용").fill("게임 개발자의 실제 업무");
  await page.getByRole("button", { name: "질문 나누기" }).click();
  await expect(page.getByText("실제 업무는?")).toBeVisible();
  await page.getByRole("button", { name: "자료 조사 시작" }).click();
  await expect(page.getByRole("heading", { name: "탐색 결과" })).toBeVisible();
  await expect(page.getByRole("link", { name: "공식 자료" })).toBeVisible();
  await page.getByRole("button", { name: "문답으로 돌아가기" }).click();
  await expect(page.getByLabel("내 생각 입력")).toBeVisible();
});
test("mobile navigation and thought map remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "사고 지도", exact: true }).click();
  await expect(page.getByText("발언이 쌓이면 관계가 보입니다.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("renders unsafe Markdown as inert content and provides code copying", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/sessions/session-one", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "session-one",
          title: "안전한 출력",
          revision: 0,
          status: "active",
        },
        messages: [
          {
            id: "a1",
            role: "assistant",
            mode: "dialogue",
            content:
              '<img src=x onerror="window.hacked=true">\n\n[위험 링크](javascript:alert(1))\n\n```javascript\nconst answer = 42;\n```',
            position: 0,
          },
        ],
      }),
    }),
  );
  await page.goto("/");
  await expect(page.getByText("const answer = 42;")).toBeVisible();
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByRole("button", { name: "코드 복사" }).click();
  await expect(page.getByRole("button", { name: "복사됨" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "const answer = 42;",
  );
});
