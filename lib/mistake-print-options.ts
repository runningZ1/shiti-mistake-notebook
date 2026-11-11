export type MistakePrintOptions = {
  template: "worksheet" | "paste";
  fontSize: 12 | 14;
  reflectionMode: "saved-or-blank" | "blank" | "saved-plus-blank";
  includeAnswers: boolean;
  includeSimilar: boolean;
};

export const pastePrintOptions: MistakePrintOptions = {
  template: "paste", fontSize: 12, reflectionMode: "saved-or-blank", includeAnswers: true, includeSimilar: false,
};
export const worksheetPrintOptions: MistakePrintOptions = {
  template: "worksheet", fontSize: 12, reflectionMode: "saved-or-blank", includeAnswers: true, includeSimilar: true,
};

export function printOptionsParams(options: MistakePrintOptions): URLSearchParams {
  return new URLSearchParams({
    template: options.template, fontSize: String(options.fontSize), reflectionMode: options.reflectionMode,
    includeAnswers: options.includeAnswers ? "1" : "0", includeSimilar: options.includeSimilar ? "1" : "0",
  });
}

/** No print parameters preserves the original worksheet contract. Invalid or duplicate options are rejected. */
export function parseMistakePrintOptions(params: URLSearchParams): MistakePrintOptions | undefined {
  const keys = ["template", "fontSize", "reflectionMode", "includeAnswers", "includeSimilar"];
  if (!keys.some(key => params.has(key))) return undefined;
  if (keys.some(key => params.getAll(key).length > 1)) throw new Error("打印设置重复，请重新选择");
  const template = params.get("template") ?? "worksheet";
  const fontSize = params.get("fontSize");
  const reflectionMode = params.get("reflectionMode");
  const includeAnswers = params.get("includeAnswers");
  const includeSimilar = params.get("includeSimilar");
  if ((template !== "worksheet" && template !== "paste") ||
    (fontSize !== null && fontSize !== "12" && fontSize !== "14") ||
    (reflectionMode !== null && !["saved-or-blank", "blank", "saved-plus-blank"].includes(reflectionMode)) ||
    (includeAnswers !== null && includeAnswers !== "0" && includeAnswers !== "1") ||
    (includeSimilar !== null && includeSimilar !== "0" && includeSimilar !== "1")) {
    throw new Error("打印设置无效，请重新选择");
  }
  const defaults = template === "paste" ? pastePrintOptions : worksheetPrintOptions;
  return {
    ...defaults, template,
    fontSize: fontSize === null ? defaults.fontSize : fontSize === "14" ? 14 : 12,
    reflectionMode: reflectionMode === null ? defaults.reflectionMode : reflectionMode as MistakePrintOptions["reflectionMode"],
    includeAnswers: includeAnswers === null ? defaults.includeAnswers : includeAnswers === "1",
    includeSimilar: includeSimilar === null ? defaults.includeSimilar : includeSimilar === "1",
  };
}
