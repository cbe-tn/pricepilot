import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  competitorOffers,
  competitors,
  discoveredListings,
  monitoringJobs,
  notifications,
  priceObservations,
  pricingRecommendations,
  products,
  salesRecords,
  stockMovements,
  supplierQuotes,
  suppliers,
  userSettings,
  users,
  workspaces,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth-password";
import { BUILTIN_CONNECTORS } from "@/lib/connectors";
import { moneyStr } from "@/lib/money";
import { recommendPrice, costFromProduct, taxFromWorkspace } from "@/lib/pricing";

const DEMO_EMAIL = "maria.s@example.com";
const STAFF_EMAIL = "quinn.m@example.net";
export const DEMO_PASSWORD = "PricePilot2026!";
export const STAFF_PASSWORD = "Staff1234!";

type SeedProduct = {
  name: string;
  brand: string;
  manufacturer: string;
  model: string;
  manufacturerRef: string;
  barcode: string;
  sku: string;
  category: string;
  subcategory: string;
  imageUrl: string;
  purchase: number;
  shipping: number;
  other: number;
  importCost?: number;
  minMargin: number;
  selling: number;
  target: number;
  stock: number;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock" | "on_order";
  supplier: string;
  warranty: string;
  specs: Record<string, string>;
  tags: string[];
  description: string;
  offers: { slug: string; price: number; availability: "in_stock" | "out_of_stock" | "limited"; conf: number; cls: "exact" | "strong"; title?: string }[];
};

const CATALOG: SeedProduct[] = [
  {
    name: "ASUS TUF Gaming A15 FA507NV",
    brand: "ASUS",
    manufacturer: "ASUS",
    model: "FA507NV-LP023",
    manufacturerRef: "FA507NV-LP023",
    barcode: "4711387582019",
    sku: "NB-ASUS-FA507NV",
    category: "Laptops",
    subcategory: "Gaming",
    imageUrl: "/images/products/laptop-gaming.jpg",
    purchase: 2890,
    shipping: 25,
    other: 15,
    minMargin: 0.12,
    selling: 3490,
    target: 3450,
    stock: 6,
    stockStatus: "in_stock",
    supplier: "Atlas Distro Maghreb",
    warranty: "24 months official",
    specs: { CPU: "Ryzen 7 7735HS", GPU: "RTX 4060 8GB", RAM: "16GB DDR5", Storage: "512GB SSD", Display: "15.6\" 144Hz" },
    tags: ["gaming", "asus", "rtx4060"],
    description: "Mainstream gaming laptop, strong demand in Tunis retail.",
    offers: [
      { slug: "mytek", price: 3599, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 3529, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 3479, availability: "limited", conf: 86, cls: "strong" },
      { slug: "graiet", price: 3649, availability: "in_stock", conf: 78, cls: "strong" },
    ],
  },
  {
    name: "Lenovo ThinkPad E14 Gen 5",
    brand: "Lenovo",
    manufacturer: "Lenovo",
    model: "E14 Gen 5",
    manufacturerRef: "21JK00B3FE",
    barcode: "196803872145",
    sku: "NB-LEN-E14G5",
    category: "Laptops",
    subcategory: "Business",
    imageUrl: "/images/products/laptop-gaming.jpg",
    purchase: 2450,
    shipping: 20,
    other: 10,
    minMargin: 0.14,
    selling: 2990,
    target: 3050,
    stock: 4,
    stockStatus: "in_stock",
    supplier: "SBS Informatique",
    warranty: "12 months on-site",
    specs: { CPU: "Intel Core i7-1355U", RAM: "16GB", Storage: "512GB SSD", Display: "14\" FHD IPS" },
    tags: ["business", "thinkpad"],
    description: "Corporate notebook, often tendered to SMEs.",
    offers: [
      { slug: "mytek", price: 3099, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 3049, availability: "in_stock", conf: 86, cls: "strong" },
      { slug: "tunisianet", price: 2999, availability: "in_stock", conf: 97, cls: "exact" },
    ],
  },
  {
    name: "HP Pavilion 15-eh3003nk",
    brand: "HP",
    manufacturer: "HP",
    model: "15-eh3003nk",
    manufacturerRef: "7N7H5EA",
    barcode: "196188445201",
    sku: "NB-HP-EH3003",
    category: "Laptops",
    subcategory: "Consumer",
    imageUrl: "/images/products/laptop-gaming.jpg",
    purchase: 1680,
    shipping: 18,
    other: 8,
    minMargin: 0.1,
    selling: 1990,
    target: 2050,
    stock: 9,
    stockStatus: "in_stock",
    supplier: "Global Distro Maghreb",
    warranty: "12 months",
    specs: { CPU: "Ryzen 5 7530U", RAM: "16GB", Storage: "512GB SSD" },
    tags: ["hp", "consumer"],
    description: "Volume consumer laptop.",
    offers: [
      { slug: "mytek", price: 2049, availability: "in_stock", conf: 86, cls: "strong" },
      { slug: "graiet", price: 2099, availability: "in_stock", conf: 78, cls: "strong" },
      { slug: "tunisianet", price: 1989, availability: "out_of_stock", conf: 86, cls: "strong" },
    ],
  },
  {
    name: "Apple MacBook Air 13 M3 8/256",
    brand: "Apple",
    manufacturer: "Apple",
    model: "MacBook Air 13 M3",
    manufacturerRef: "MRXN3FN/A",
    barcode: "195949049218",
    sku: "NB-APP-MBA13M3",
    category: "Laptops",
    subcategory: "Ultrabook",
    imageUrl: "/images/products/laptop-gaming.jpg",
    purchase: 3890,
    shipping: 0,
    other: 25,
    minMargin: 0.08,
    selling: 4490,
    target: 4550,
    stock: 2,
    stockStatus: "low_stock",
    supplier: "Atlas Distro Maghreb",
    warranty: "12 months Apple",
    specs: { Chip: "Apple M3", RAM: "8GB", Storage: "256GB", Color: "Midnight" },
    tags: ["apple", "premium"],
    description: "High-consideration premium notebook.",
    offers: [
      { slug: "mytek", price: 4599, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 4549, availability: "limited", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 4499, availability: "in_stock", conf: 97, cls: "exact" },
    ],
  },
  {
    name: "MSI GeForce RTX 4070 Ventus 2X 12G",
    brand: "MSI",
    manufacturer: "MSI",
    model: "RTX 4070 Ventus 2X",
    manufacturerRef: "V513-006R",
    barcode: "4711377138842",
    sku: "VGA-MSI-4070V2X",
    category: "Graphics Cards",
    subcategory: "NVIDIA",
    imageUrl: "/images/products/gpu.jpg",
    purchase: 2140,
    shipping: 12,
    other: 8,
    minMargin: 0.1,
    selling: 2490,
    target: 2520,
    stock: 5,
    stockStatus: "in_stock",
    supplier: "SBS Informatique",
    warranty: "36 months",
    specs: { VRAM: "12GB GDDR6X", Bus: "PCIe 4.0", Ports: "3x DP, 1x HDMI" },
    tags: ["gpu", "rtx4070"],
    description: "1440p gaming GPU, price-sensitive category.",
    offers: [
      { slug: "mytek", price: 2549, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 2479, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 2519, availability: "in_stock", conf: 86, cls: "strong" },
      { slug: "graiet", price: 2599, availability: "out_of_stock", conf: 78, cls: "strong" },
    ],
  },
  {
    name: "Gigabyte GeForce RTX 4060 Ti WINDFORCE 8G",
    brand: "Gigabyte",
    manufacturer: "Gigabyte",
    model: "RTX 4060 Ti WINDFORCE",
    manufacturerRef: "GV-N406TWF2OC-8GD",
    barcode: "4719331314392",
    sku: "VGA-GIG-4060TI",
    category: "Graphics Cards",
    subcategory: "NVIDIA",
    imageUrl: "/images/products/gpu.jpg",
    purchase: 1680,
    shipping: 10,
    other: 6,
    minMargin: 0.11,
    selling: 1990,
    target: 1980,
    stock: 3,
    stockStatus: "low_stock",
    supplier: "Global Distro Maghreb",
    warranty: "36 months",
    specs: { VRAM: "8GB GDDR6", Boost: "2550 MHz" },
    tags: ["gpu", "rtx4060ti"],
    description: "1080p/1440p sweet spot GPU.",
    offers: [
      { slug: "mytek", price: 2049, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 1979, availability: "in_stock", conf: 86, cls: "strong" },
      { slug: "tunisianet", price: 2019, availability: "limited", conf: 86, cls: "strong" },
    ],
  },
  {
    name: "AMD Ryzen 7 7700X",
    brand: "AMD",
    manufacturer: "AMD",
    model: "Ryzen 7 7700X",
    manufacturerRef: "100-100000591WOF",
    barcode: "730143314154",
    sku: "CPU-AMD-7700X",
    category: "Processors",
    subcategory: "AMD",
    imageUrl: "/images/products/cpu.jpg",
    purchase: 890,
    shipping: 6,
    other: 4,
    minMargin: 0.12,
    selling: 1090,
    target: 1080,
    stock: 11,
    stockStatus: "in_stock",
    supplier: "SBS Informatique",
    warranty: "36 months",
    specs: { Cores: "8", Threads: "16", Socket: "AM5", TDP: "105W" },
    tags: ["cpu", "am5"],
    description: "Popular AM5 CPU for creator PCs.",
    offers: [
      { slug: "mytek", price: 1129, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 1099, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 1079, availability: "in_stock", conf: 97, cls: "exact" },
    ],
  },
  {
    name: "Intel Core i5-14400F",
    brand: "Intel",
    manufacturer: "Intel",
    model: "Core i5-14400F",
    manufacturerRef: "BX8071514400F",
    barcode: "735858575109",
    sku: "CPU-INT-14400F",
    category: "Processors",
    subcategory: "Intel",
    imageUrl: "/images/products/cpu.jpg",
    purchase: 620,
    shipping: 5,
    other: 3,
    minMargin: 0.13,
    selling: 749,
    target: 760,
    stock: 14,
    stockStatus: "in_stock",
    supplier: "Atlas Distro Maghreb",
    warranty: "36 months",
    specs: { Cores: "10", Threads: "16", Socket: "LGA1700" },
    tags: ["cpu", "intel"],
    description: "Value gaming CPU without iGPU.",
    offers: [
      { slug: "mytek", price: 779, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "graiet", price: 799, availability: "in_stock", conf: 86, cls: "strong" },
      { slug: "spacenet", price: 759, availability: "in_stock", conf: 97, cls: "exact" },
    ],
  },
  {
    name: "Kingston Fury Beast 32GB (2x16) DDR5 5600",
    brand: "Kingston",
    manufacturer: "Kingston",
    model: "Fury Beast DDR5 5600 32GB",
    manufacturerRef: "KF556C40BBK2-32",
    barcode: "740617325185",
    sku: "RAM-KIN-32D556",
    category: "RAM",
    subcategory: "DDR5",
    imageUrl: "/images/products/ram.jpg",
    purchase: 285,
    shipping: 4,
    other: 2,
    minMargin: 0.15,
    selling: 359,
    target: 365,
    stock: 22,
    stockStatus: "in_stock",
    supplier: "Global Distro Maghreb",
    warranty: "Lifetime",
    specs: { Capacity: "32GB", Speed: "5600MT/s", Kit: "2x16GB" },
    tags: ["ram", "ddr5"],
    description: "High-turn kit for AM5/Intel builds.",
    offers: [
      { slug: "mytek", price: 379, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 349, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 369, availability: "in_stock", conf: 86, cls: "strong" },
    ],
  },
  {
    name: "Corsair Vengeance 16GB (2x8) DDR5 5200",
    brand: "Corsair",
    manufacturer: "Corsair",
    model: "Vengeance DDR5 5200 16GB",
    manufacturerRef: "CMK16GX5M2B5200C40",
    barcode: "840006662145",
    sku: "RAM-COR-16D552",
    category: "RAM",
    subcategory: "DDR5",
    imageUrl: "/images/products/ram.jpg",
    purchase: 165,
    shipping: 3,
    other: 1,
    minMargin: 0.14,
    selling: 209,
    target: 215,
    stock: 18,
    stockStatus: "in_stock",
    supplier: "SBS Informatique",
    warranty: "Lifetime",
    specs: { Capacity: "16GB", Speed: "5200MT/s" },
    tags: ["ram"],
    description: "Entry DDR5 kit.",
    offers: [
      { slug: "mytek", price: 219, availability: "in_stock", conf: 86, cls: "strong" },
      { slug: "graiet", price: 229, availability: "in_stock", conf: 78, cls: "strong" },
    ],
  },
  {
    name: "Samsung 990 PRO 2TB NVMe",
    brand: "Samsung",
    manufacturer: "Samsung",
    model: "990 PRO 2TB",
    manufacturerRef: "MZ-V9P2T0BW",
    barcode: "887276663218",
    sku: "SSD-SAM-990P2T",
    category: "SSDs",
    subcategory: "NVMe",
    imageUrl: "/images/products/ssd.jpg",
    purchase: 540,
    shipping: 4,
    other: 2,
    minMargin: 0.12,
    selling: 649,
    target: 655,
    stock: 7,
    stockStatus: "in_stock",
    supplier: "Atlas Distro Maghreb",
    warranty: "5 years",
    specs: { Capacity: "2TB", Interface: "PCIe 4.0 x4", SeqRead: "7450MB/s" },
    tags: ["ssd", "nvme"],
    description: "Flagship client SSD.",
    offers: [
      { slug: "mytek", price: 679, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 639, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 659, availability: "limited", conf: 86, cls: "strong" },
    ],
  },
  {
    name: "WD Black SN850X 1TB",
    brand: "Western Digital",
    manufacturer: "WD",
    model: "SN850X 1TB",
    manufacturerRef: "WDS100T2X0E",
    barcode: "718037895412",
    sku: "SSD-WD-850X1T",
    category: "SSDs",
    subcategory: "NVMe",
    imageUrl: "/images/products/ssd.jpg",
    purchase: 285,
    shipping: 3,
    other: 2,
    minMargin: 0.13,
    selling: 349,
    target: 355,
    stock: 10,
    stockStatus: "in_stock",
    supplier: "Global Distro Maghreb",
    warranty: "5 years",
    specs: { Capacity: "1TB", Interface: "PCIe 4.0" },
    tags: ["ssd"],
    description: "Gaming SSD with strong street price movement.",
    offers: [
      { slug: "mytek", price: 369, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 339, availability: "in_stock", conf: 86, cls: "strong" },
      { slug: "graiet", price: 359, availability: "in_stock", conf: 78, cls: "strong" },
    ],
  },
  {
    name: "LG UltraGear 27GP850-B 27\" 165Hz",
    brand: "LG",
    manufacturer: "LG",
    model: "27GP850-B",
    manufacturerRef: "27GP850-B",
    barcode: "8806091245001",
    sku: "MON-LG-27GP850",
    category: "Monitors",
    subcategory: "Gaming",
    imageUrl: "/images/products/monitor.jpg",
    purchase: 920,
    shipping: 18,
    other: 8,
    minMargin: 0.11,
    selling: 1099,
    target: 1120,
    stock: 4,
    stockStatus: "in_stock",
    supplier: "SBS Informatique",
    warranty: "24 months",
    specs: { Size: "27\"", Panel: "Nano IPS", Refresh: "165Hz", Res: "2560x1440" },
    tags: ["monitor", "1440p"],
    description: "Popular 1440p Nano IPS monitor.",
    offers: [
      { slug: "mytek", price: 1149, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 1090, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 1129, availability: "out_of_stock", conf: 86, cls: "strong" },
    ],
  },
  {
    name: "Dell S2722DGM 27\" 165Hz",
    brand: "Dell",
    manufacturer: "Dell",
    model: "S2722DGM",
    manufacturerRef: "S2722DGM",
    barcode: "884116391245",
    sku: "MON-DEL-S2722",
    category: "Monitors",
    subcategory: "Gaming",
    imageUrl: "/images/products/monitor.jpg",
    purchase: 710,
    shipping: 16,
    other: 6,
    minMargin: 0.12,
    selling: 849,
    target: 860,
    stock: 0,
    stockStatus: "out_of_stock",
    supplier: "Atlas Distro Maghreb",
    warranty: "36 months",
    specs: { Size: "27\"", Panel: "VA", Refresh: "165Hz", Res: "2560x1440" },
    tags: ["monitor"],
    description: "Curved VA gaming monitor currently awaiting replenishment.",
    offers: [
      { slug: "mytek", price: 879, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "graiet", price: 899, availability: "in_stock", conf: 78, cls: "strong" },
    ],
  },
  {
    name: "TP-Link Archer AX73 AX5400",
    brand: "TP-Link",
    manufacturer: "TP-Link",
    model: "Archer AX73",
    manufacturerRef: "Archer AX73",
    barcode: "6935364010890",
    sku: "NET-TPL-AX73",
    category: "Routers",
    subcategory: "Wi-Fi 6",
    imageUrl: "/images/products/router.jpg",
    purchase: 310,
    shipping: 8,
    other: 3,
    minMargin: 0.16,
    selling: 399,
    target: 405,
    stock: 13,
    stockStatus: "in_stock",
    supplier: "Local Import TN",
    warranty: "36 months",
    specs: { Standard: "Wi-Fi 6", Class: "AX5400", Bands: "Dual" },
    tags: ["wifi6", "router"],
    description: "Home/SMB Wi-Fi 6 router.",
    offers: [
      { slug: "mytek", price: 419, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 389, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 409, availability: "in_stock", conf: 86, cls: "strong" },
    ],
  },
  {
    name: "HP LaserJet Pro MFP 4103fdw",
    brand: "HP",
    manufacturer: "HP",
    model: "LaserJet Pro 4103fdw",
    manufacturerRef: "2Z628A",
    barcode: "194850845512",
    sku: "PRN-HP-4103FDW",
    category: "Printers",
    subcategory: "Laser MFP",
    imageUrl: "/images/products/router.jpg",
    purchase: 1180,
    shipping: 22,
    other: 10,
    minMargin: 0.12,
    selling: 1390,
    target: 1420,
    stock: 3,
    stockStatus: "low_stock",
    supplier: "SBS Informatique",
    warranty: "12 months",
    specs: { Type: "Mono laser MFP", Duplex: "Yes", Ethernet: "Yes" },
    tags: ["printer", "office"],
    description: "Office workhorse MFP.",
    offers: [
      { slug: "mytek", price: 1449, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "graiet", price: 1499, availability: "in_stock", conf: 78, cls: "strong" },
      { slug: "tunisianet", price: 1379, availability: "limited", conf: 86, cls: "strong" },
    ],
  },
  {
    name: "Logitech MX Master 3S",
    brand: "Logitech",
    manufacturer: "Logitech",
    model: "MX Master 3S",
    manufacturerRef: "910-006561",
    barcode: "5099206098778",
    sku: "ACC-LOG-MX3S",
    category: "Accessories",
    subcategory: "Mice",
    imageUrl: "/images/products/mouse.jpg",
    purchase: 245,
    shipping: 3,
    other: 1,
    minMargin: 0.18,
    selling: 329,
    target: 335,
    stock: 16,
    stockStatus: "in_stock",
    supplier: "Local Import TN",
    warranty: "24 months",
    specs: { Sensor: "8K DPI", Connectivity: "BT + Logi Bolt", Color: "Graphite" },
    tags: ["mouse", "logitech"],
    description: "Best-seller productivity mouse.",
    offers: [
      { slug: "mytek", price: 349, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 319, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "tunisianet", price: 339, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "graiet", price: 359, availability: "in_stock", conf: 78, cls: "strong" },
    ],
  },
  {
    name: "ASUS ROG Strix B650-A Gaming WiFi",
    brand: "ASUS",
    manufacturer: "ASUS",
    model: "ROG Strix B650-A",
    manufacturerRef: "90MB1BV0-M0EAY0",
    barcode: "4711081902456",
    sku: "MB-ASUS-B650A",
    category: "Motherboards",
    subcategory: "AM5",
    imageUrl: "/images/products/ssd.jpg",
    purchase: 620,
    shipping: 8,
    other: 4,
    minMargin: 0.12,
    selling: 749,
    target: 760,
    stock: 5,
    stockStatus: "in_stock",
    supplier: "Atlas Distro Maghreb",
    warranty: "36 months",
    specs: { Socket: "AM5", Chipset: "B650", Form: "ATX", WiFi: "Wi-Fi 6E" },
    tags: ["motherboard", "am5"],
    description: "AM5 board bundled with 7700X builds.",
    offers: [
      { slug: "mytek", price: 779, availability: "in_stock", conf: 97, cls: "exact" },
      { slug: "spacenet", price: 759, availability: "limited", conf: 86, cls: "strong" },
    ],
  },
];

const DISCOVERIES = [
  { slug: "mytek", title: "ASUS Dual RTX 4070 SUPER OC 12GB", brand: "ASUS", ref: "DUAL-RTX4070S-O12G", category: "Graphics Cards", price: 2899, url: "https://www.mytek.tn/asus-dual-rtx-4070-super" },
  { slug: "spacenet", title: "Kingston NV3 2TB NVMe", brand: "Kingston", ref: "SNV3S/2000G", category: "SSDs", price: 429, url: "https://www.spacenet.tn/kingston-nv3-2tb" },
  { slug: "tunisianet", title: "Lenovo LOQ 15 RTX 4050", brand: "Lenovo", ref: "83DV00D8FG", category: "Laptops", price: 3290, url: "https://www.tunisianet.com.tn/lenovo-loq-15" },
  { slug: "graiet", title: "TP-Link Deco XE75 Pro 2-pack", brand: "TP-Link", ref: "Deco XE75 Pro", category: "Routers", price: 899, url: "https://www.graiet.tn/deco-xe75-pro" },
  { slug: "mytek", title: "Samsung Odyssey G5 32\" 165Hz", brand: "Samsung", ref: "LS32CG510EUXEN", category: "Monitors", price: 1099, url: "https://www.mytek.tn/odyssey-g5-32" },
  { slug: "spacenet", title: "AMD Ryzen 5 7600", brand: "AMD", ref: "100-100001015BOX", category: "Processors", price: 679, url: "https://www.spacenet.tn/ryzen-5-7600" },
  { slug: "tunisianet", title: "Logitech MX Keys S", brand: "Logitech", ref: "920-011584", category: "Accessories", price: 389, url: "https://www.tunisianet.com.tn/mx-keys-s" },
  { slug: "mytek", title: "Corsair RM750x 750W Gold", brand: "Corsair", ref: "CP-9020200-EU", category: "Accessories", price: 549, url: "https://www.mytek.tn/rm750x" },
];

let seeding: Promise<void> | null = null;

export async function ensureDemoSeed(): Promise<void> {
  if (seeding) return seeding;
  seeding = (async () => {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
    if (existing.length) return;
    await seedDemoWorkspace();
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}

async function seedDemoWorkspace(): Promise<void> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "Atlas Info Distribution",
      legalName: "Atlas Info Distribution SARL",
      city: "Tunis",
      country: "Tunisia",
      phone: "+216 71 000 000",
      website: "https://atlasinfo.tn",
      defaultCurrency: "TND",
      defaultVatRate: "0.190",
      purchasePricesIncludeVat: false,
      sellingPricesIncludeVat: true,
      defaultMinMargin: "0.120",
      variableSellingCostRate: "0.015",
      monthlyOperatingCosts: "4200.000",
      onboardingCompleted: true,
      onboardingStep: 7,
    })
    .returning();

  const ownerHash = await hashPassword(DEMO_PASSWORD);
  const staffHash = await hashPassword(STAFF_PASSWORD);

  const [owner] = await db
    .insert(users)
    .values({
      workspaceId: workspace.id,
      email: DEMO_EMAIL,
      passwordHash: ownerHash,
      fullName: "Karim Ben Youssef",
      role: "owner",
      phone: "+216 98 000 111",
      jobTitle: "Managing Director",
      lastLoginAt: new Date(),
    })
    .returning();

  const [staff] = await db
    .insert(users)
    .values({
      workspaceId: workspace.id,
      email: STAFF_EMAIL,
      passwordHash: staffHash,
      fullName: "Leila Trabelsi",
      role: "staff",
      phone: "+216 22 000 222",
      jobTitle: "Pricing analyst",
    })
    .returning();

  await db.insert(userSettings).values([
    { userId: owner.id, emailNotifications: true, weeklyReportEmail: true, alertPriceDropPct: "0.030" },
    { userId: staff.id, emailNotifications: true, weeklyReportEmail: false, alertPriceDropPct: "0.040" },
  ]);

  const competitorRows = [];
  for (const c of BUILTIN_CONNECTORS) {
    const [row] = await db
      .insert(competitors)
      .values({
        workspaceId: workspace.id,
        slug: c.slug,
        name: c.name,
        domain: c.domain,
        websiteUrl: c.websiteUrl,
        logoText: c.logoText,
        listingUrl: c.listingUrl,
        searchUrlTemplate: c.searchUrlTemplate,
        enabled: true,
        connectorStatus: "demo",
        connectorNotes: c.notes,
        lastSuccessfulCheck: new Date(Date.now() - 2 * 60 * 60 * 1000),
        nextCheckAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        isBuiltIn: true,
        isDemo: true,
        monitoringFrequencyMinutes: 360,
      })
      .returning();
    competitorRows.push(row);
  }
  const bySlug = Object.fromEntries(competitorRows.map((c) => [c.slug, c]));

  const [supAtlas] = await db
    .insert(suppliers)
    .values({
      workspaceId: workspace.id,
      name: "Atlas Distro Maghreb",
      contactName: "Nabil Gharbi",
      email: "nina.v@example.com",
      phone: "+216 71 111 222",
      city: "Tunis",
      notes: "Primary notebook & Apple channel.",
    })
    .returning();
  const [supSbs] = await db
    .insert(suppliers)
    .values({
      workspaceId: workspace.id,
      name: "SBS Informatique",
      contactName: "Sonia Mejri",
      email: "olivia.t@example.org",
      phone: "+216 71 333 444",
      city: "Sfax",
      notes: "Components and peripherals.",
    })
    .returning();
  const [supGlobal] = await db
    .insert(suppliers)
    .values({
      workspaceId: workspace.id,
      name: "Global Distro Maghreb",
      contactName: "Hichem Jaziri",
      email: "tina.r@example.net",
      phone: "+216 70 555 666",
      city: "Ariana",
    })
    .returning();
  const [supLocal] = await db
    .insert(suppliers)
    .values({
      workspaceId: workspace.id,
      name: "Local Import TN",
      contactName: "Amina Khelifi",
      email: "tina.r@example.net",
      phone: "+216 50 777 888",
      city: "Ben Arous",
    })
    .returning();

  const supplierByName: Record<string, string> = {
    "Atlas Distro Maghreb": supAtlas.id,
    "SBS Informatique": supSbs.id,
    "Global Distro Maghreb": supGlobal.id,
    "Local Import TN": supLocal.id,
  };

  const now = Date.now();
  let priceChangeCount = 0;
  const notifBatch: (typeof notifications.$inferInsert)[] = [];
  const observationBatch: (typeof priceObservations.$inferInsert)[] = [];
  const discoveryBatch: (typeof discoveredListings.$inferInsert)[] = [];

  for (const item of CATALOG) {
    const [product] = await db
      .insert(products)
      .values({
        workspaceId: workspace.id,
        name: item.name,
        brand: item.brand,
        manufacturer: item.manufacturer,
        model: item.model,
        manufacturerRef: item.manufacturerRef,
        barcode: item.barcode,
        sku: item.sku,
        category: item.category,
        subcategory: item.subcategory,
        imageUrl: item.imageUrl,
        purchasePrice: moneyStr(item.purchase),
        shippingCost: moneyStr(item.shipping),
        importCost: moneyStr(item.importCost ?? 0),
        otherCosts: moneyStr(item.other),
        vatRate: "0.190",
        minProfitMargin: moneyStr(item.minMargin),
        targetSellingPrice: moneyStr(item.target),
        actualSellingPrice: moneyStr(item.selling),
        stockQty: item.stock,
        stockStatus: item.stockStatus,
        supplierName: item.supplier,
        warranty: item.warranty,
        condition: "new",
        description: item.description,
        specifications: item.specs,
        tags: item.tags,
        monitoringStatus: "active",
        savedStrategy: "balanced",
        isDemo: true,
      })
      .returning();

    const tax = taxFromWorkspace(workspace, product.vatRate);
    const cost = costFromProduct(product);
    const rec = recommendPrice({
      cost,
      tax,
      minMargin: item.minMargin,
      currentSellingTtc: item.selling,
      targetSellingTtc: item.target,
      offers: item.offers.map((o) => ({
        priceTnd: o.price,
        availability: o.availability,
        matchClass: o.cls,
        excludedFromBenchmark: false,
        condition: "new",
      })),
      strategy: "balanced",
      advantages: { warranty: true, inStockWhileOthersOut: item.stock > 0 },
    });

    await db.insert(pricingRecommendations).values({
      workspaceId: workspace.id,
      productId: product.id,
      strategy: "balanced",
      recommendedPrice: moneyStr(rec.recommendedTtc),
      expectedProfit: moneyStr(rec.breakdown.grossProfit),
      expectedMargin: moneyStr(rec.breakdown.grossMargin),
      explanation: rec.explanation,
      confidence: rec.confidence,
      flaggedLoss: rec.flaggedLoss,
      isDemo: true,
    });

    const sid = supplierByName[item.supplier];
    if (sid) {
      await db.insert(supplierQuotes).values({
        workspaceId: workspace.id,
        supplierId: sid,
        productId: product.id,
        productRef: item.manufacturerRef,
        productName: item.name,
        quotedPrice: moneyStr(item.purchase),
        moq: 1,
        leadTimeDays: 4,
        shippingCost: moneyStr(item.shipping),
        quotedAt: new Date(now - 6 * 86400000),
        expiresAt: new Date(now + 21 * 86400000),
      });
    }

    await db.insert(stockMovements).values({
      workspaceId: workspace.id,
      productId: product.id,
      type: "purchase",
      quantity: item.stock + 8,
      unitCost: moneyStr(item.purchase),
      note: "Opening stock (demo)",
      createdAt: new Date(now - 28 * 86400000),
    });
    if (item.stock > 0) {
      await db.insert(salesRecords).values({
        workspaceId: workspace.id,
        productId: product.id,
        quantity: Math.max(1, Math.round(3 + (item.name.length % 5))),
        unitPrice: moneyStr(item.selling),
        soldAt: new Date(now - 3 * 86400000),
        channel: "store",
      });
    }

    for (const offer of item.offers) {
      const competitor = bySlug[offer.slug];
      if (!competitor) continue;
      const [row] = await db
        .insert(competitorOffers)
        .values({
          workspaceId: workspace.id,
          productId: product.id,
          competitorId: competitor.id,
          title: offer.title ?? item.name,
          brand: item.brand,
          model: item.model,
          manufacturerRef: item.manufacturerRef,
          barcode: item.barcode,
          url: `${competitor.websiteUrl}/p/${item.sku.toLowerCase()}`,
          priceTnd: moneyStr(offer.price),
          availability: offer.availability,
          condition: "new",
          matchClass: offer.cls,
          matchConfidence: offer.conf,
          matchReason:
            offer.cls === "exact"
              ? "Exact manufacturer reference after normalization"
              : "Same brand and model with compatible specifications",
          excludedFromBenchmark: false,
          isDemo: true,
          lastCheckedAt: new Date(now - 90 * 60000),
        })
        .returning();

      const points = 10;
      let price = offer.price * 1.06;
      let prevAvail: "in_stock" | "out_of_stock" | "limited" = "in_stock";
      for (let i = points; i >= 0; i--) {
        const observedAt = new Date(now - i * 3.5 * 86400000);
        const drift = Math.sin(i + item.name.length) * 0.012;
        price = Math.max(offer.price * 0.92, price * (1 - 0.008 + drift));
        if (i === 0) price = offer.price;
        const prev = i === points ? null : price * 1.01;
        const event =
          prev && price < prev * 0.995 ? "decrease" : prev && price > prev * 1.005 ? "increase" : "unchanged";
        if (event !== "unchanged") priceChangeCount += 1;
        const availability: "in_stock" | "out_of_stock" | "limited" = i === 0 ? offer.availability : prevAvail;
        observationBatch.push({
          workspaceId: workspace.id,
          offerId: row.id,
          productId: product.id,
          competitorId: competitor.id,
          priceTnd: moneyStr(round3(price)),
          previousPriceTnd: prev ? moneyStr(round3(prev)) : null,
          availability,
          eventType: event,
          isDemo: true,
          observedAt,
        });
        prevAvail = availability;
      }

      if (offer.price < item.selling && offer.availability === "in_stock") {
        notifBatch.push({
          workspaceId: workspace.id,
          userId: owner.id,
          type: "price_undercut",
          title: `${competitor.name} undercuts ${item.name}`,
          body: `${competitor.name} lists this product at ${offer.price.toFixed(3)} TND, below your selling price of ${item.selling.toFixed(3)} TND. Illustrative demo observation.`,
          href: `/products/${product.id}`,
          productId: product.id,
          competitorId: competitor.id,
          dedupeKey: `undercut:${product.id}:${competitor.id}`,
        });
      }
    }
  }

  for (const d of DISCOVERIES) {
    const competitor = bySlug[d.slug];
    discoveryBatch.push({
      workspaceId: workspace.id,
      competitorId: competitor?.id,
      title: d.title,
      brand: d.brand,
      manufacturerRef: d.ref,
      category: d.category,
      priceTnd: moneyStr(d.price),
      availability: "in_stock",
      url: d.url,
      firstSeenAt: new Date(now - (12 + d.title.length % 40) * 3600000),
      identificationConfidence: 74,
      alreadyInCatalog: false,
      status: "new",
      isDemo: true,
      rediscovery: false,
    });
  }
  for (let i = 0; i < observationBatch.length; i += 80) {
    await db.insert(priceObservations).values(observationBatch.slice(i, i + 80));
  }
  if (discoveryBatch.length) await db.insert(discoveredListings).values(discoveryBatch);

  await db.insert(notifications).values([
    ...notifBatch.slice(0, 8),
    {
      workspaceId: workspace.id,
      userId: owner.id,
      type: "new_product",
      title: "Mytek listed ASUS Dual RTX 4070 SUPER",
      body: "A new graphics card listing was discovered on Mytek. Demo observation — confirm before purchasing.",
      href: "/discovery",
      dedupeKey: "disc:4070s",
    },
    {
      workspaceId: workspace.id,
      userId: owner.id,
      type: "margin_below_min",
      title: "MacBook Air M3 margin is tight",
      body: "Expected gross margin is close to your 8% floor after acquisition costs. Review the recommendation.",
      href: "/recommendations",
      dedupeKey: "margin:mba",
    },
    {
      workspaceId: workspace.id,
      userId: owner.id,
      type: "price_increase_opportunity",
      title: "SpaceNet raised RTX 4070 street price",
      body: "A competitor increase may let you recover margin without losing the lowest-in-stock position.",
      href: "/history",
      dedupeKey: "opp:4070",
    },
    {
      workspaceId: workspace.id,
      userId: owner.id,
      type: "unavailable",
      title: "Dell S2722DGM is out of stock in your warehouse",
      body: "Market still has availability. Replenish or pause monitoring if you no longer sell this SKU.",
      href: "/inventory",
      dedupeKey: "oos:dell",
    },
    {
      workspaceId: workspace.id,
      userId: owner.id,
      type: "market_report",
      title: "Weekly market summary is ready",
      body: "18 tracked products, several undercuts on accessories and RAM, two new GPU listings.",
      href: "/reports",
      dedupeKey: "weekly:demo",
      readAt: new Date(now - 86400000),
    },
    {
      workspaceId: workspace.id,
      userId: owner.id,
      type: "connector_failure",
      title: "Graiet connector remains limited",
      body: "No official feed is configured. Connectivity checks succeed, but product extraction is disabled.",
      href: "/competitors",
      dedupeKey: "conn:graiet",
      readAt: new Date(now - 2 * 86400000),
    },
  ]);

  for (const c of competitorRows) {
    await db.insert(monitoringJobs).values({
      workspaceId: workspace.id,
      competitorId: c.id,
      status: "success",
      startedAt: new Date(now - 2 * 3600000 - 8 * 60000),
      finishedAt: new Date(now - 2 * 3600000),
      productsChecked: CATALOG.length,
      changesDetected: 2,
      trigger: "scheduled",
    });
    await db
      .update(competitors)
      .set({
        trackedProductCount: CATALOG.filter((p) => p.offers.some((o) => o.slug === c.slug)).length,
        newListingsCount: DISCOVERIES.filter((d) => d.slug === c.slug).length,
        priceChangesCount: Math.max(3, priceChangeCount % 17),
      })
      .where(eq(competitors.id, c.id));
  }
}

function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}
