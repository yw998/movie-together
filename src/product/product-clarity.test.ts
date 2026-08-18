import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const appPath = new URL("../App.tsx", import.meta.url);
const guidePath = new URL("./ProductGuide.tsx", import.meta.url);
const accountPath = new URL("../auth/AccountControl.tsx", import.meta.url);
const groupPanelPath = new URL("../channels/ChannelPanel.tsx", import.meta.url);
const messagesPath = new URL("../i18n/messages.ts", import.meta.url);

describe("product positioning and identity clarity", () => {
  it("keeps schedule discovery as the headline and makes collaboration explicit", async () => {
    const [app, messages] = await Promise.all([readFile(appPath, "utf8"), readFile(messagesPath, "utf8")]);
    expect(app).toContain('t("hero.title")');
    for (const copy of ["这周看什么？", "共同标记、分享具体场次", "创建观影小组", "只有受邀成员可以看到小组内容"]) expect(messages).toContain(copy);
  });

  it("exposes the same four primary destinations", async () => {
    const [app, messages] = await Promise.all([readFile(appPath, "utf8"), readFile(messagesPath, "utf8")]);
    for (const key of ["nav.schedule", "nav.filmFams", "nav.notifications", "nav.account"]) expect(app).toContain(`t("${key}")`);
    for (const label of ["排片", "观影小组", "通知", "账号", "Schedule", "Film Fams", "Notifications", "Account"]) expect(messages).toContain(label);
  });

  it("explains the workflow and both identity models without promising itinerary tools", async () => {
    const [guide, messages] = await Promise.all([readFile(guidePath, "utf8"), readFile(messagesPath, "utf8")]);
    for (const label of ["浏览排片", "建立小组", "标记想看", "一起查看", "个人账号", "小组身份"]) expect(messages).toContain(label);
    expect(messages).toContain("观影小组是只有受邀成员可见的共享空间。");
    expect(guide).not.toContain("不是聊天、报名或行程规划工具");
    expect(messages).toContain("个人代码丢失后无法找回");
  });

  it("requires an explicit identity choice before no-email group creation", async () => {
    const account = await readFile(accountPath, "utf8");
    expect(account).toContain('mode === "channel_create_choice"');
    expect(account).toContain("使用个人账号");
    expect(account).toContain("使用小组身份（无需邮箱）");
    expect(account).toContain("只能绑定同一个观影小组");
  });

  it("labels immutable display names as nicknames with an explicit warning", async () => {
    const [account, groupPanel] = await Promise.all([
      readFile(accountPath, "utf8"),
      readFile(groupPanelPath, "utf8"),
    ]);
    expect(account).toContain('copy("昵称", "Display name")');
    expect(groupPanel).toContain('copy("昵称", "Display name")');
    expect(account).toContain("创建后不可修改");
    expect(account).not.toContain("不可修改的显示名");
  });

  it("gives creation and account-merge completions a clear next step and exit", async () => {
    const account = await readFile(accountPath, "utf8");
    expect(account.match(/进入我的小组/g)?.length).toBeGreaterThanOrEqual(2);
    expect(account).toContain("dialog-completion");
    expect(account).toContain("取消并关闭");
    expect(account).toContain("onOpenGroup?.(channelId)");
  });

  it("routes an already-registered upgrade email to personal-account login", async () => {
    const account = await readFile(accountPath, "utf8");
    expect(account).toContain('error?.code === "user_already_exists"');
    expect(account).toContain("转到个人账号登录");
    expect(account).toContain("defaultValue={loginEmail}");
    expect(account).toContain("登录成功后会继续连接小组身份");
  });
});
