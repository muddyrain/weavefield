import { expect, type Locator } from '@playwright/test';

// 实际打开 Radix 菜单并点击可见选项；不修改隐藏表单字段代替用户操作。
export async function choose(trigger: Locator, value: string | { label: string }) {
  await trigger.click();
  const page = trigger.page();
  const option = typeof value === 'string' ? page.locator(`[role="option"][data-value=${JSON.stringify(value)}]`) : page.getByRole('option', { name: value.label, exact: true });
  await expect(option).toBeVisible(); await option.click();
}
