import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


OUTPUT_DIR = Path("/tmp/zolotoeyabloko-ui")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
EXPECTED_TOTAL = json.loads(Path("docs/data.json").read_text())["all"]["kpi"]["total"]


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    page_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    page.goto("http://127.0.0.1:8765")
    page.wait_for_load_state("networkidle")
    expect(page).to_have_title("Пульс месяца — «Золотое Яблоко», Омск")
    expect(page.locator("#monthFilter button")).to_have_count(6)
    expect(page.locator(".kpi-card")).to_have_count(8)
    expect(page.locator("#monthFilter button.active")).to_have_count(1)

    page.get_by_role("button", name="Весь период").click()
    expect(page.locator("#activePeriodLabel")).to_have_text("Весь период")
    expect(page.locator("#heroTotal")).to_have_text(
        f"{EXPECTED_TOTAL:,}".replace(",", " "), timeout=2_000
    )

    page.locator("#ops [data-sort='zapis']").click()
    expect(page.locator("#ops th").nth(3)).to_have_attribute("aria-sort", "descending")

    page.locator("#appointmentSearch").fill("zzzz-no-result")
    expect(page.locator("#appts")).to_contain_text("Ничего не найдено")
    page.locator("#appointmentSearch").fill("")

    page.locator(".refusal-group summary").first.click()
    expect(page.locator(".refusal-group").first).to_have_attribute("open", "")
    page.screenshot(path=OUTPUT_DIR / "desktop.png", full_page=True)

    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile_errors = []
    mobile.on("pageerror", lambda error: mobile_errors.append(str(error)))
    mobile.goto("http://127.0.0.1:8765")
    mobile.wait_for_load_state("networkidle")
    expect(mobile.locator(".kpi-card")).to_have_count(8)
    expect(mobile.locator("#monthFilter button")).to_have_count(6)
    body_widths = mobile.evaluate(
        "() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})"
    )
    assert body_widths["scroll"] <= body_widths["client"] + 1, body_widths
    mobile.screenshot(path=OUTPUT_DIR / "mobile.png", full_page=True)

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    assert not mobile_errors, mobile_errors
    print("UI smoke passed:", body_widths)
    browser.close()
