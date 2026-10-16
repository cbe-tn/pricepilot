import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Anton, Cairo, Montserrat, Playfair_Display } from "next/font/google";
import { db } from "@/db";
import { marketingCampaigns } from "@/db/schema";
import { PosterEditor } from "@/components/marketing/PosterEditor";
import { PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { loadPosterProducts } from "@/lib/marketing";
import { normalizeDesign, type PosterDesign } from "@/lib/poster";

export const metadata = { title: "Affiche" };

// Poster typography: Montserrat (Latin, like NUMEDIA's posters), Cairo (Arabic + Latin digits),
// Anton (condensed display, flash/podium styles) and Playfair Display (editorial style).
const montserrat = Montserrat({ subsets: ["latin"], weight: ["500", "600", "800", "900"], display: "block", variable: "--font-poster-latin" });
const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["500", "600", "800", "900"], display: "block", variable: "--font-poster-arabic" });
const anton = Anton({ subsets: ["latin"], weight: "400", display: "block", variable: "--font-poster-display" });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "700", "800", "900"], display: "block", variable: "--font-poster-serif" });

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAuth();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [campaign] = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!campaign) notFound();
  const products = await loadPosterProducts(auth.workspace.id, campaign.productIds);

  return (
    // The font variables make Next load both families (the UI keeps its own font); the canvas draws with them.
    <div className={`${montserrat.variable} ${cairo.variable} ${anton.variable} ${playfair.variable}`}>
      <PageHeader
        title={campaign.name}
        subtitle="Modifiez les textes, l’ordre et la mise en page ; les prix et les photos viennent du catalogue. Validez pour débloquer le téléchargement."
        actions={
          <Link href="/marketing" className="h-10 rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm leading-10 text-[#0b4a56]">
            Retour au studio
          </Link>
        }
      />
      <PosterEditor
        campaign={{
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          validatedAt: campaign.validatedAt ? campaign.validatedAt.toISOString() : null,
          design: normalizeDesign(campaign.design as Partial<PosterDesign>, products),
          versions: campaign.versions.map((v) => ({ at: v.at, design: normalizeDesign(v.design as Partial<PosterDesign>, products) })),
        }}
        initialProducts={products}
        fonts={{ latin: montserrat.style.fontFamily, arabic: cairo.style.fontFamily, display: anton.style.fontFamily, serif: playfair.style.fontFamily }}
      />
    </div>
  );
}
