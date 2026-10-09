/** Laboratory flag is not clinical significance. Direction and related results decide what is worth showing. */

export type ClinicalSignificance =
  | "CLINICALLY_SIGNIFICANT"
  | "POTENTIALLY_SIGNIFICANT"
  | "MINOR_ISOLATED_DEVIATION"
  | "NORMAL_OR_ACCEPTABLE"
  | "INDETERMINATE";

export type ClinicalReview = {
  significance: ClinicalSignificance;
  include_in_key_patterns: boolean;
  omit_from_adverse_findings: string[];
  instruction: string;
};

type Hist = { value?: string; flag?: string };
type Param = {
  parameter_name: string;
  param_code?: string;
  value: string;
  flag: string;
  abnormal: boolean;
  history?: Hist[];
};

type Group = { id: string; parameters: Param[] };

function blob(p: Param): string {
  return `${p.param_code || ""} ${p.parameter_name}`.toLowerCase().replace(/\./g, "");
}

function flagOf(p: Param): string {
  return String(p.flag || "").trim().toUpperCase();
}

function isHigh(p: Param): boolean {
  const f = flagOf(p);
  return f === "H" || f === "HH" || f === "A" || f.includes("HIGH");
}

function isLow(p: Param): boolean {
  const f = flagOf(p);
  return f === "L" || f === "LL" || f.includes("LOW");
}

function num(value: string | undefined): number | null {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function findRole(parameters: Param[], role: (b: string) => boolean): Param | undefined {
  return parameters.find((p) => role(blob(p)));
}

function trendOf(p: Param, higherIsWorse: boolean): "worsening" | "persistent" | "none" {
  const history = p.history || [];
  if (!history.length) return "none";
  const adversePrior = history.filter((h) => {
    const f = String(h.flag || "").toUpperCase();
    return f === "H" || f === "L" || f === "HH" || f === "LL";
  });
  const current = num(p.value);
  const oldest = num(history[history.length - 1]?.value);
  if (current != null && oldest != null && adversePrior.length) {
    const span = Math.max(Math.abs(oldest) * 0.05, 0.2);
    const worse = higherIsWorse ? current > oldest + span : current < oldest - span;
    if (worse) return "worsening";
  }
  if (history.length >= 2 && adversePrior.length >= 2) return "persistent";
  return "none";
}

function upgrade(base: ClinicalSignificance, parameters: Param[], higherIsWorse: boolean): ClinicalSignificance {
  if (base === "NORMAL_OR_ACCEPTABLE" || base === "CLINICALLY_SIGNIFICANT") return base;
  const worsening = parameters.some((p) => trendOf(p, higherIsWorse) === "worsening");
  const persistent = parameters.some((p) => trendOf(p, higherIsWorse) === "persistent");
  if (base === "MINOR_ISOLATED_DEVIATION") return worsening ? "POTENTIALLY_SIGNIFICANT" : base;
  if (base === "POTENTIALLY_SIGNIFICANT" && (worsening || persistent)) return "CLINICALLY_SIGNIFICANT";
  if (base === "INDETERMINATE" && worsening) return "POTENTIALLY_SIGNIFICANT";
  return base;
}

function review(
  significance: ClinicalSignificance,
  include: boolean,
  omit: string[],
  instruction: string,
): ClinicalReview {
  return { significance, include_in_key_patterns: include, omit_from_adverse_findings: omit, instruction };
}

function lipidReview(parameters: Param[]): ClinicalReview {
  const ratio = parameters.filter((p) => /ldl\s*\/\s*hdl|ldl\/hdl|hdlc ratio|cholesterol\s*\/\s*hdl|tc\s*\/\s*hdl/.test(blob(p)));
  const hdl = findRole(parameters, (b) => /\bhdl\b/.test(b) && !/ldl|ratio|\//.test(b));
  const ldl = findRole(parameters, (b) => /\bldl\b/.test(b) && !/hdl|ratio|\//.test(b));
  const tc = findRole(parameters, (b) => /total cholesterol/.test(b) || (/\bcholesterol\b/.test(b) && !/hdl|ldl|non-hdl|vldl/.test(b)));
  const tg = findRole(parameters, (b) => /triglyceride|\btg\b/.test(b));
  const core = [hdl, ldl, tc, tg].filter(Boolean) as Param[];
  const coreHigh = core.filter((p) => p !== hdl && isHigh(p));
  const hdlLow = !!hdl && isLow(hdl);
  const omit = ratio.filter((p) => isLow(p)).map((p) => p.parameter_name);
  const favorableNote = omit.length
    ? ` Do not describe ${omit.join(", ")} as an adverse abnormality. A lower ratio is not clinically unfavorable.`
    : "";
  if (!hdlLow && coreHigh.length === 0) {
    return review(
      "NORMAL_OR_ACCEPTABLE",
      false,
      omit,
      "No adverse lipid pattern. Do not create a key pattern from a laboratory flag on a ratio where a lower value is favorable." + favorableNote,
    );
  }
  if (hdlLow && coreHigh.length === 0) {
    return review(
      upgrade("MINOR_ISOLATED_DEVIATION", hdl ? [hdl] : [], false),
      true,
      omit,
      "HDL is below the laboratory desirable level while the other available lipid parameters are within limits. Call this an isolated laboratory finding, not a dyslipidemic pattern. Do not recommend repeat lipid testing for this alone." + favorableNote,
    );
  }
  if (coreHigh.length >= 2 || (coreHigh.length >= 1 && hdlLow)) {
    return review(
      upgrade("CLINICALLY_SIGNIFICANT", core, true),
      true,
      omit,
      "Related lipid parameters form a broader pattern. Interpret them together." + favorableNote,
    );
  }
  return review(
    upgrade("POTENTIALLY_SIGNIFICANT", coreHigh, true),
    true,
    omit,
    "One lipid parameter is outside the reference range and the others are acceptable. Do not call this a broad dyslipidemia." + favorableNote,
  );
}

function glucoseReview(parameters: Param[]): ClinicalReview {
  const fbs = findRole(parameters, (b) => /\bfbs\b|fasting/.test(b));
  const ppbs = findRole(parameters, (b) => /ppbs|post prandial|postprandial/.test(b));
  const a1c = findRole(parameters, (b) => /hba1c|a1c|glycated|glycosylated/.test(b));
  const markers = [fbs, ppbs, a1c].filter(Boolean) as Param[];
  const high = markers.filter(isHigh);
  if (!high.length) {
    return review("NORMAL_OR_ACCEPTABLE", false, [], "Available glycaemic markers are not adversely elevated. Do not create a glucose pattern.");
  }
  if (high.length === 1 && markers.length >= 2) {
    const only = high[0];
    const name = only === fbs ? "fasting glucose" : only === ppbs ? "post-prandial glucose" : "HbA1c";
    return review(
      upgrade("POTENTIALLY_SIGNIFICANT", high, true),
      true,
      [],
      `Isolated ${name} elevation. Other available glycaemic markers are within range. Do not describe a broad glycaemic or diabetes pattern.`,
    );
  }
  if (high.length >= 2) {
    return review(
      upgrade("CLINICALLY_SIGNIFICANT", high, true),
      true,
      [],
      "More than one glycaemic marker is elevated. Interpret FBS, PPBS and HbA1c together as one pattern.",
    );
  }
  return review(upgrade("POTENTIALLY_SIGNIFICANT", high, true), true, [], "A glycaemic marker is elevated and related markers are not all available. Do not overstate the pattern.");
}

function redCellReview(parameters: Param[]): ClinicalReview | null {
  const hb = findRole(parameters, (b) => /haemoglobin|hemoglobin|(^|[^a-z])hb([^a-z]|$)/.test(b) && !/a1c/.test(b));
  const mcv = findRole(parameters, (b) => /\bmcv\b/.test(b));
  const mch = findRole(parameters, (b) => /\bmch\b/.test(b) && !/mchc/.test(b));
  const rdw = findRole(parameters, (b) => /\brdw\b/.test(b));
  if (!hb || !isLow(hb)) return null;
  const micro = !!mcv && isLow(mcv) && ((!!mch && isLow(mch)) || (!!rdw && isHigh(rdw)));
  if (micro) {
    return review(
      upgrade("CLINICALLY_SIGNIFICANT", [hb, mcv, mch, rdw].filter(Boolean) as Param[], false),
      true,
      [],
      "Low haemoglobin with microcytic/hypochromic indices. Describe one red-cell pattern, not separate abnormalities. Do not name a disease.",
    );
  }
  const indicesNormal = (!mcv || !isLow(mcv)) && (!mch || !isLow(mch));
  if (indicesNormal && (mcv || mch)) {
    return review(
      upgrade("POTENTIALLY_SIGNIFICANT", [hb], false),
      true,
      [],
      "Haemoglobin is low while MCV/MCH are not low. Do not describe a microcytic pattern.",
    );
  }
  return null;
}

function renalReview(parameters: Param[]): ClinicalReview | null {
  const creat = findRole(parameters, (b) => /creatinine/.test(b));
  const egfr = findRole(parameters, (b) => /\begfr\b|\bgfr\b/.test(b));
  if (!creat || !isHigh(creat)) return null;
  if (egfr && !isLow(egfr)) {
    const otherAdverse = parameters.filter((p) => p !== creat && p !== egfr && (isHigh(p) || isLow(p)));
    if (!otherAdverse.length) {
      return review(
        "MINOR_ISOLATED_DEVIATION",
        true,
        [],
        "Creatinine is high but eGFR is not reduced. Do not describe reduced renal function from creatinine alone.",
      );
    }
    return review(
      upgrade("POTENTIALLY_SIGNIFICANT", otherAdverse, true),
      true,
      [],
      "Creatinine is high but eGFR is not reduced, so do not describe reduced renal function. Mention any separate electrolyte abnormality on its own.",
    );
  }
  if (egfr && isLow(egfr)) {
    return review(
      upgrade("CLINICALLY_SIGNIFICANT", [creat, egfr], false),
      true,
      [],
      "Creatinine is high and eGFR is reduced. Interpret them together. Do not diagnose a kidney disease.",
    );
  }
  return review("POTENTIALLY_SIGNIFICANT", true, [], "Creatinine is high and eGFR is not available. Do not infer reduced filtration.");
}

function thyroidReview(parameters: Param[]): ClinicalReview | null {
  const tsh = findRole(parameters, (b) => /\btsh\b/.test(b));
  const ft4 = findRole(parameters, (b) => /free t4|\bft4\b/.test(b));
  if (!tsh || !isHigh(tsh)) return null;
  if (ft4 && isLow(ft4)) {
    return review(
      upgrade("CLINICALLY_SIGNIFICANT", [tsh, ft4], true),
      true,
      [],
      "TSH is high and free T4 is low. Describe one thyroid pattern. Do not state a diagnosis.",
    );
  }
  if (ft4 && !isLow(ft4) && !isHigh(ft4)) {
    return review(
      upgrade("POTENTIALLY_SIGNIFICANT", [tsh], true),
      true,
      [],
      "TSH is high and free T4 is within range. Do not label a thyroid disorder from TSH alone.",
    );
  }
  return review("POTENTIALLY_SIGNIFICANT", true, [], "TSH is high and free T4 is not available. Do not label a thyroid disorder.");
}

function liverReview(parameters: Param[]): ClinicalReview | null {
  const alt = findRole(parameters, (b) => /\balt\b|\bsgpt\b/.test(b));
  const others = parameters.filter((p) => /ast|sgot|\balp\b|\bggt\b|bilirubin/.test(blob(p)));
  if (!alt || !isHigh(alt)) return null;
  const otherAdverse = others.filter((p) => isHigh(p) || ( /albumin/.test(blob(p)) && isLow(p)));
  if (!otherAdverse.length && others.length) {
    return review(
      "MINOR_ISOLATED_DEVIATION",
      true,
      [],
      "ALT is elevated and the other available liver parameters are not similarly abnormal. Call it an isolated finding, not a liver disease pattern.",
    );
  }
  if (otherAdverse.length) {
    return review(
      upgrade("CLINICALLY_SIGNIFICANT", [alt, ...otherAdverse], true),
      true,
      [],
      "More than one liver parameter is abnormal. Describe one liver pattern, not a list.",
    );
  }
  return null;
}

function genericReview(parameters: Param[]): ClinicalReview {
  const adverse = parameters.filter((p) => p.abnormal && (isHigh(p) || isLow(p)));
  if (!adverse.length) {
    return review("NORMAL_OR_ACCEPTABLE", false, [], "No adversely flagged result in this group. Omit it from key patterns.");
  }
  if (adverse.length === 1) {
    return review(
      upgrade("POTENTIALLY_SIGNIFICANT", adverse, isHigh(adverse[0])),
      true,
      [],
      "A single related result is outside the reference range. Do not expand it into a disease pattern.",
    );
  }
  return review(
    upgrade("CLINICALLY_SIGNIFICANT", adverse, true),
    true,
    [],
    "Several related results are outside the reference range. Interpret them as one pattern.",
  );
}

export function reviewClinicalGroup(group: Group): ClinicalReview {
  if (group.id === "lipid") return lipidReview(group.parameters);
  if (group.id === "glucose") return glucoseReview(group.parameters);
  if (group.id === "renal") {
    const renal = renalReview(group.parameters);
    if (renal) return renal;
  }
  if (group.id === "thyroid") {
    const thyroid = thyroidReview(group.parameters);
    if (thyroid) return thyroid;
  }
  if (group.id === "liver") {
    const liver = liverReview(group.parameters);
    if (liver) return liver;
  }
  if (group.id === "haematology" || group.id === "iron") {
    const red = redCellReview(group.parameters);
    if (red) return red;
  }
  return genericReview(group.parameters);
}

export function reviewDoctorOnePagerInput<T extends { groups: Group[] }>(input: T): T & { groups: (Group & { clinical_review: ClinicalReview })[] } {
  return {
    ...input,
    groups: input.groups.map((group) => ({ ...group, clinical_review: reviewClinicalGroup(group) })),
  };
}

function mentions(text: string, name: string): boolean {
  const needle = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (needle.length < 3) return false;
  return text.toLowerCase().includes(needle);
}

export function applyClinicalPriority(summary: any, input: { groups: (Group & { clinical_review: ClinicalReview })[] }): any {
  const reviews = input.groups.map((g) => g.clinical_review);
  const omit = reviews.flatMap((r) => r.omit_from_adverse_findings);
  const worthFollowUp = reviews.some((r) => r.significance === "CLINICALLY_SIGNIFICANT" || r.significance === "POTENTIALLY_SIGNIFICANT");
  const patterns = (summary.clinical_patterns || [])
    .map((pattern: any) => {
      const findings = (pattern.current_findings || []).filter((line: string) => !omit.some((name) => mentions(line, name)));
      return { ...pattern, current_findings: findings };
    })
    .filter((pattern: any) => {
      const text = `${pattern.pattern_name} ${pattern.integrated_interpretation}`;
      const onlyOmitted = omit.length > 0 && omit.some((name) => mentions(text, name)) && !(pattern.current_findings || []).length;
      if (onlyOmitted) return false;
      const matched = input.groups.filter((g) =>
        g.parameters.some((p) => mentions(`${pattern.pattern_name} ${(pattern.current_findings || []).join(" ")}`, p.parameter_name)),
      );
      if (matched.length && matched.every((g) => !g.clinical_review.include_in_key_patterns)) return false;
      return true;
    })
    .slice(0, 4);
  let points = (summary.points_for_clinical_review || []).slice(0, 3);
  if (!points.length) points = ["No additional laboratory-specific points for review identified."];
  return {
    ...summary,
    clinical_patterns: patterns,
    points_for_clinical_review: points,
    suggested_follow_up: worthFollowUp ? summary.suggested_follow_up || [] : [],
  };
}