// Libellés français des valeurs stockées en base (les valeurs techniques restent en anglais).

const LABELS: Record<string, string> = {
  // disponibilité / stock
  in_stock: "En stock",
  out_of_stock: "Rupture",
  limited: "Stock limité",
  preorder: "Précommande",
  unknown: "Inconnu",
  low_stock: "Stock faible",
  on_order: "En commande",
  discontinued: "Arrêté",
  // qualité de correspondance
  exact: "Exacte",
  strong: "Forte",
  possible: "Possible",
  unverified: "Non vérifiée",
  // état du produit
  new: "Neuf",
  refurbished: "Reconditionné",
  used: "Occasion",
  bundle: "Pack",
  // connecteurs
  ready: "Prêt",
  error: "Erreur",
  disabled: "Désactivé",
  demo: "Démo",
  // tâches de surveillance
  queued: "En attente",
  running: "En cours",
  success: "Réussie",
  failed: "Échec",
  partial: "Partielle",
  // événements de prix
  increase: "Hausse",
  decrease: "Baisse",
  back_in_stock: "Retour en stock",
  new_listing: "Nouvelle offre",
  removed: "Retirée",
  market_move: "Mouvement du marché",
  unchanged: "Inchangé",
  // mouvements de stock
  purchase: "Achat",
  sale: "Vente",
  return: "Retour",
  adjustment: "Ajustement",
  replenishment: "Réapprovisionnement",
  // statut de suivi produit
  active: "Actif",
  paused: "En pause",
  archived: "Archivé",
  // découverte
  added: "Ajouté",
  ignored: "Ignoré",
  watchlist: "À surveiller",
  // stratégies
  competitive: "Compétitive",
  balanced: "Équilibrée",
  premium: "Premium",
  // rôles
  owner: "Propriétaire",
  administrator: "Administrateur",
  staff: "Collaborateur",
  purchasing: "Acheteur",
  // déclencheurs
  manual: "Manuel",
  scheduled: "Planifié",
  // erreurs de surveillance
  connectivity: "Connexion",
  blocked: "Accès refusé",
  network: "Réseau",
  parse: "Lecture de la page",
  no_other_seller: "Aucun autre vendeur",
  // journal des modifications
  create_product: "Produit créé",
  update_product: "Produit modifié",
  delete_product: "Produit supprimé",
  duplicate_product: "Produit dupliqué",
  archive_product: "Produit archivé",
  restore_product: "Produit restauré",
  import_products: "Import de produits",
  save_recommendation: "Recommandation enregistrée",
  invite_user: "Membre ajouté",
  update_profile: "Profil modifié",
  update_workspace: "Espace modifié",
  // types de notification
  new_product: "Nouveau produit",
  price_undercut: "Concurrent moins cher",
  below_min_price: "Sous le prix minimum",
  price_increase_opportunity: "Opportunité de hausse",
  unavailable: "Indisponible",
  margin_below_min: "Marge sous le minimum",
  unprofitable: "Non rentable",
  connector_failure: "Échec du connecteur",
  market_report: "Rapport marché",
  system: "Système",
};

/** Libellé français d'une valeur d'énumération ; renvoie la valeur telle quelle si inconnue. */
export function fr(value: string | null | undefined): string {
  if (!value) return "—";
  return LABELS[value] ?? value.replace(/_/g, " ");
}
