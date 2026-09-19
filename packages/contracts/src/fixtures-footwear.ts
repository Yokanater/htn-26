import {
  type Candidate,
  type Evidence,
  type Profile,
  type Report,
  SCHEMA_VERSION,
} from "./index";

const candidate = (
  id: string,
  name: string,
  category: string,
  tagline: string,
  mark: string,
  score: number,
  idea: string,
  reason: string,
  type?: Candidate["type"],
): Candidate => ({
  id,
  name,
  domain: `${name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
  category,
  tagline,
  description: tagline,
  tone: ["sage", "peach", "lilac", "blue", "yellow"][score % 5],
  mark,
  score,
  confidence: score > 85 ? "High" : "Medium",
  idea,
  reason,
  caveat:
    "Illustrative fit only. Confirm audience overlap, sustainability claims, pricing, and fulfillment capacity before making contact.",
  evidenceIds: [`${id}_catalog`, `${id}_review`],
  type,
  components: [
    {
      label: type ? "Product / job overlap" : "Complementary customer job",
      score,
      weight: 30,
    },
    { label: "Audience overlap", score: score - 2, weight: 20 },
    { label: "Price & positioning", score: score - 1, weight: 15 },
    { label: "Operational fit", score: score - 3, weight: 15 },
    { label: "Evidence quality", score: score - 4, weight: 10 },
    {
      label: type ? "Source diversity" : "Partnership novelty",
      score: score + 3,
      weight: 10,
    },
  ],
});

const collaborators = [
  candidate(
    "trailkind",
    "TrailKind",
    "Performance socks",
    "Natural comfort from the ground up.",
    "textile",
    92,
    "The everyday walking kit",
    "Merino socks complement comfortable footwear and share an everyday-movement customer job.",
  ),
  candidate(
    "weatherbound",
    "Weatherbound",
    "Lightweight outerwear",
    "Ready when the weather changes.",
    "bag",
    89,
    "A city-to-trail capsule",
    "Packable outerwear extends a comfort-led footwear story into complete transitional outfits.",
  ),
  candidate(
    "carrylight",
    "Carry Light",
    "Recycled bags",
    "Carry less. Go farther.",
    "bag",
    87,
    "The low-impact commute",
    "Recycled everyday bags pair naturally with sustainable shoes for commuting and travel.",
  ),
  candidate(
    "stepcare",
    "Step Care",
    "Foot care",
    "Recovery for people in motion.",
    "jar",
    84,
    "Comfort after the last mile",
    "Foot-care products address recovery after walking without overlapping the footwear catalog.",
  ),
  candidate(
    "roam",
    "Roam Bottle Co.",
    "Reusable hydration",
    "Refill your everyday.",
    "kettle",
    81,
    "The daily miles challenge",
    "Reusable bottles support the same active, lower-waste lifestyle positioning.",
  ),
  candidate(
    "citycycle",
    "City Cycle",
    "Urban mobility",
    "A better way across town.",
    "book",
    78,
    "Car-free commute week",
    "An urban mobility partnership creates a credible occasion for comfortable everyday shoes.",
  ),
];

const competitors = [
  candidate(
    "treadwell",
    "Treadwell",
    "Sustainable sneakers",
    "Lighter steps, lower impact.",
    "textile",
    94,
    "Make material impact easier to compare",
    "A direct alternative combining natural materials, comfort, and sustainability claims.",
    "direct",
  ),
  candidate(
    "lumastep",
    "Luma Step",
    "Everyday footwear",
    "All-day comfort without the bulk.",
    "bag",
    89,
    "Clarify the all-day comfort proof",
    "Comfort-first casual shoes compete for the same daily-wear occasions.",
    "direct",
  ),
  candidate(
    "everform",
    "Everform Footwear",
    "Natural-material shoes",
    "Made by nature. Shaped for motion.",
    "textile",
    86,
    "Show the material story at product level",
    "Natural-material construction and minimalist styling overlap directly with the brand promise.",
    "direct",
  ),
  candidate(
    "terrarun",
    "Terra Run",
    "Running footwear",
    "Daily miles, responsibly made.",
    "bag",
    82,
    "Separate everyday comfort from performance",
    "Responsible running shoes are adjacent when customers move from casual walking to training.",
    "adjacent",
  ),
  candidate(
    "coast",
    "Coast Sandals",
    "Minimal sandals",
    "Less shoe. More summer.",
    "textile",
    75,
    "Own transitional-weather occasions",
    "Minimal sandals can substitute for casual sneakers during warm-weather travel.",
    "substitute",
  ),
];

export function footwearFixtureReport(profile: Profile, id: string): Report {
  const evidence: Evidence[] = [...collaborators, ...competitors].flatMap(
    (item) => [
      {
        id: `${item.id}_catalog`,
        title: `${item.name} · sample storefront`,
        sourceType: "First-party catalog",
        span: `${item.name} offers ${item.category.toLowerCase()}. ${item.tagline} This is a fictional catalog excerpt created for the product demo.`,
        publishedAt: "2026-09-18",
        url: null,
        synthetic: true,
      },
      {
        id: `${item.id}_review`,
        title: `${item.name} · sample community discussion`,
        sourceType: "Independent discussion",
        span: "“I want comfortable products that hold up to daily walking without looking overly technical.” Fictional customer comment used to demonstrate evidence presentation.",
        publishedAt: "2026-09-16",
        url: null,
        synthetic: true,
      },
    ],
  );
  const source = profile.research?.sources[0];
  evidence.push({
    id: "store_catalog",
    title: `${profile.name} · captured brand profile`,
    sourceType: "Merchant storefront",
    span:
      source?.span ||
      `${profile.name} is categorized as ${profile.category.toLowerCase()}. Confirm its assortment and positioning before using this illustrative report.`,
    publishedAt: source?.fetchedAt.slice(0, 10) || "2026-09-19",
    url: source?.url ?? null,
    synthetic: !source,
  });
  const item = (
    id: string,
    title: string,
    description: string,
    evidenceIds: string[],
    observation = false,
  ) => ({
    id,
    title,
    description,
    evidenceIds,
    confidence: "Medium",
    claimType: observation ? ("observation" as const) : ("inference" as const),
  });
  const now = new Date().toISOString();
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    profile,
    status: "completed",
    phase: "synthesizing",
    createdAt: now,
    updatedAt: now,
    mode: "demo",
    warning:
      "The store profile was captured live. Suggested brands and market commentary remain fictional, category-matched demo data.",
    collaborators,
    competitors,
    evidence,
    themes: [
      {
        id: "praise",
        kind: "Praise",
        title: "Comfort without a technical look",
        description:
          "Sample comments value footwear that works for long days while remaining easy to style.",
        mentions: 3,
        evidenceIds: ["treadwell_review", "lumastep_review", "everform_review"],
      },
      {
        id: "complaint",
        kind: "Complaint",
        title: "Evidence gap: long-term durability",
        description:
          "The fixture does not establish durability after extended wear. Collect verified owner reviews before making this claim.",
        mentions: 0,
        evidenceIds: [],
      },
      {
        id: "switching",
        kind: "Switching trigger",
        title: "Evidence gap: what causes brand switching",
        description:
          "No real switching evidence has been collected for this preview.",
        mentions: 0,
        evidenceIds: [],
      },
      {
        id: "unmet",
        kind: "Unmet need",
        title: "A complete low-impact commute",
        description:
          "Sample evidence suggests testing a simple shoe, sock, and carry combination for everyday travel.",
        mentions: 2,
        evidenceIds: ["trailkind_review", "carrylight_review"],
      },
    ],
    swot: {
      strengths: [
        item(
          "s1",
          "A recognizable comfort promise",
          "The captured storefront leads with comfortable everyday footwear.",
          ["store_catalog"],
          true,
        ),
        item(
          "s2",
          "Natural-material positioning",
          "The live profile gives the brand a concrete sustainability and material story.",
          ["store_catalog"],
          true,
        ),
        item(
          "s3",
          "Multiple everyday occasions",
          "Walking, commuting, and travel create several useful merchandising contexts.",
          ["store_catalog"],
        ),
      ],
      weaknesses: [
        item(
          "w1",
          "Impact claims need comparison",
          "Customers may struggle to compare sustainability claims across footwear brands.",
          ["treadwell_catalog", "store_catalog"],
        ),
        item(
          "w2",
          "Durability evidence is incomplete",
          "This preview contains no verified long-term wear evidence.",
          [],
        ),
        item(
          "w3",
          "Comfort language is crowded",
          "Several fictional competitors use similar all-day comfort positioning.",
          ["lumastep_catalog", "everform_catalog"],
        ),
      ],
      opportunities: [
        item(
          "o1",
          "Build the complete walking kit",
          "Test footwear with complementary socks rather than another shoe product.",
          ["trailkind_catalog", "trailkind_review"],
        ),
        item(
          "o2",
          "Own the low-impact commute",
          "A recycled-bag collaboration could make the sustainability story tangible.",
          ["carrylight_catalog", "store_catalog"],
        ),
        item(
          "o3",
          "Extend comfort into recovery",
          "Foot care provides a credible post-walk partnership occasion.",
          ["stepcare_catalog", "stepcare_review"],
        ),
      ],
      threats: [
        item(
          "t1",
          "Direct natural-material alternatives",
          "Other footwear brands can make similar material and impact claims.",
          ["treadwell_catalog", "everform_catalog"],
        ),
        item(
          "t2",
          "Performance brands moving casual",
          "Running brands can extend into everyday walking occasions.",
          ["terrarun_catalog"],
        ),
        item(
          "t3",
          "Seasonal substitutes",
          "Sandals can replace casual sneakers for warm-weather travel.",
          ["coast_catalog", "coast_review"],
        ),
      ],
    },
    actions: [
      {
        title: "Test an everyday walking kit",
        experiment:
          "Show a shoe-and-sock bundle concept to 20 customers. Continue if at least 5 request launch details.",
        effort: "1 week · low effort",
        evidenceIds: ["trailkind_catalog", "trailkind_review"],
      },
      {
        title: "Clarify material impact",
        experiment:
          "Test a side-by-side material explainer on one product page and measure detail-page engagement.",
        effort: "1 week · medium effort",
        evidenceIds: ["store_catalog", "treadwell_catalog"],
      },
      {
        title: "Explore the commute occasion",
        experiment:
          "Interview 8 urban commuters about what they carry and wear for daily trips before designing a collaboration.",
        effort: "3 days · low effort",
        evidenceIds: ["carrylight_catalog", "citycycle_review"],
      },
    ],
  };
}
