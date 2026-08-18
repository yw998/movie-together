type ProductGuideProps = {
  open: boolean;
  onClose: () => void;
  onCreateGroup: () => void;
};
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";

const steps: { title: MessageKey; copy: MessageKey }[] = [
  { title: "guide.step1Title", copy: "guide.step1Copy" },
  { title: "guide.step2Title", copy: "guide.step2Copy" },
  { title: "guide.step3Title", copy: "guide.step3Copy" },
  { title: "guide.step4Title", copy: "guide.step4Copy" },
];

export function ProductGuide({ open, onClose, onCreateGroup }: ProductGuideProps) {
  const { t } = useI18n();
  if (!open) return null;

  return <div className="product-guide-backdrop" role="presentation" onMouseDown={onClose}>
    <section aria-labelledby="product-guide-title" aria-modal="true" className="product-guide" onMouseDown={(event) => event.stopPropagation()} role="dialog">
      <button aria-label={t("guide.close")} className="product-guide-close" onClick={onClose} type="button">×</button>
      <span className="eyebrow dark">HOW IT WORKS</span>
      <h2 id="product-guide-title">{t("guide.title")}</h2>
      <p className="product-guide-lead">{t("guide.lead")}</p>
      <ol className="product-steps">
        {steps.map((step) => <li key={step.title}><b>{t(step.title)}</b><span>{t(step.copy)}</span></li>)}
      </ol>
      <div className="identity-comparison">
        <article>
          <h3>{t("guide.account")}</h3>
          <p>{t("guide.accountCopy")}</p>
          <ul><li>{t("guide.accountItem1")}</li><li>{t("guide.accountItem2")}</li><li>{t("guide.accountItem3")}</li></ul>
        </article>
        <article>
          <h3>{t("guide.profile")} <small>{t("guide.noEmail")}</small></h3>
          <p>{t("guide.profileCopy")}</p>
          <ul><li>{t("guide.profileItem1")}</li><li>{t("guide.profileItem2")}</li><li>{t("guide.profileItem3")}</li></ul>
        </article>
      </div>
      <p className="product-guide-note">{t("guide.note")}</p>
      <button className="product-guide-cta" onClick={() => { onClose(); onCreateGroup(); }} type="button">{t("hero.createFam")}</button>
    </section>
  </div>;
}
