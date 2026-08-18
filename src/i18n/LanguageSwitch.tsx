import { ENGLISH_UI_ENABLED } from "./locales";
import { useI18n } from "./I18nContext";

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  if (!ENGLISH_UI_ENABLED) return null;
  return (
    <div aria-label={t("language.selector")} className="language-switch" role="group">
      <button aria-pressed={locale === "zh-CN"} onClick={() => setLocale("zh-CN")} type="button">
        {t("language.switchToChinese")}
      </button>
      <span aria-hidden="true">/</span>
      <button aria-pressed={locale === "en-US"} onClick={() => setLocale("en-US")} type="button">
        {t("language.switchToEnglish")}
      </button>
    </div>
  );
}
