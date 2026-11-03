import katex from "katex";
import "katex/dist/katex.min.css";

type FormulaProps = {
  readonly tex: string;
  readonly display?: boolean;
};

export function Formula({ tex, display = false }: FormulaProps) {
  const html = katex.renderToString(tex, {
    throwOnError: true,
    output: "html",
    displayMode: display,
    trust: false,
  });

  if (display) {
    return (
      <div
        dir="ltr"
        className="overflow-x-auto py-1 text-center"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX renders trusted math with HTML commands disabled (trust: false).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <span
      dir="ltr"
      className="inline-block align-middle"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX renders trusted math with HTML commands disabled (trust: false).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
