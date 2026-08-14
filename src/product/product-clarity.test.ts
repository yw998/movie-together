import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const appPath = new URL("../App.tsx", import.meta.url);
const guidePath = new URL("./ProductGuide.tsx", import.meta.url);
const accountPath = new URL("../auth/AccountControl.tsx", import.meta.url);

describe("product positioning and identity clarity", () => {
  it("keeps schedule discovery as the headline and makes collaboration explicit", async () => {
    const app = await readFile(appPath, "utf8");
    expect(app).toContain("<h1>这周看什么？</h1>");
    expect(app).toContain("共同标记、分享具体场次");
    expect(app).toContain("创建观影小组");
    expect(app).toContain("只有受邀成员可以看到小组内容");
  });

  it("exposes the same four primary destinations", async () => {
    const app = await readFile(appPath, "utf8");
    for (const label of ["排片", "观影小组", "通知", "账号"]) expect(app).toContain(`</span>${label}</button>`);
  });

  it("explains the workflow and both identity models without promising itinerary tools", async () => {
    const guide = await readFile(guidePath, "utf8");
    for (const label of ["浏览排片", "建立小组", "标记想看", "一起查看", "个人账号", "小组身份"]) expect(guide).toContain(label);
    expect(guide).toContain("不是聊天、报名或行程规划工具");
    expect(guide).toContain("个人代码丢失后无法找回");
  });

  it("requires an explicit identity choice before no-email group creation", async () => {
    const account = await readFile(accountPath, "utf8");
    expect(account).toContain('mode === "channel_create_choice"');
    expect(account).toContain("使用个人账号");
    expect(account).toContain("使用小组身份（无需邮箱）");
    expect(account).toContain("只能绑定同一个观影小组");
  });
});
