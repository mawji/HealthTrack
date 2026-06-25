// Tier-1 source cards: low-friction, open, public-domain US public-health
// sources. These are the "use first" set from the evidence-coach plan. Add
// USDA FoodData Central + Dietary Guidelines cards alongside their rules when
// Phase 3/4 land; for now we seed the sources the Phase 1 rules cite.

import { SourceCard } from "./types";

export const SOURCE_CARDS: SourceCard[] = [
  {
    id: "odphp-pag",
    name: "Physical Activity Guidelines for Americans",
    publisher: "U.S. Dept. of Health & Human Services (ODPHP)",
    url: "https://health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines",
    jurisdiction: "US",
    license: "U.S. federal public domain; attribute, no implied endorsement",
    attribution: "Source: ODPHP",
    published: "2nd ed., 2018",
  },
  {
    id: "cdc-healthy-weight",
    name: "CDC — Healthy Weight (Adult BMI)",
    publisher: "U.S. Centers for Disease Control and Prevention",
    url: "https://www.cdc.gov/healthy-weight-growth/about/index.html",
    jurisdiction: "US",
    license: "U.S. federal public domain; attribute, no implied endorsement",
    attribution: "Source: CDC",
  },
  {
    id: "cdc-sleep",
    name: "CDC — About Sleep (adult sleep duration)",
    publisher: "U.S. Centers for Disease Control and Prevention",
    url: "https://www.cdc.gov/sleep/about/index.html",
    jurisdiction: "US",
    license: "U.S. federal public domain; attribute, no implied endorsement",
    attribution: "Source: CDC",
  },
  {
    id: "cdc-diabetes-a1c",
    name: "CDC — All About Your A1C",
    publisher: "U.S. Centers for Disease Control and Prevention",
    url: "https://www.cdc.gov/diabetes/managing/managing-blood-sugar/a1c.html",
    jurisdiction: "US",
    license: "U.S. federal public domain; attribute, no implied endorsement",
    attribution: "Source: CDC",
  },
  {
    id: "aha-cdc-bp",
    name: "Blood Pressure Categories (AHA / CDC)",
    publisher: "American Heart Association; U.S. CDC",
    url: "https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings",
    jurisdiction: "US",
    license: "Categories are widely published facts; cite + link, no copied prose",
    attribution: "Source: AHA/CDC",
  },
  {
    id: "uspstf",
    name: "USPSTF Recommendations (preventive screening)",
    publisher: "U.S. Preventive Services Task Force / AHRQ",
    url: "https://www.uspreventiveservicestaskforce.org/uspstf/topic_search_results",
    jurisdiction: "US",
    license: "AHRQ permits reproduction with restrictions; we cite + link, derive prompts only",
    attribution: "Source: USPSTF",
  },
];

const BY_ID = new Map(SOURCE_CARDS.map((s) => [s.id, s]));

export function getSource(id: string): SourceCard | undefined {
  return BY_ID.get(id);
}
