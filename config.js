// Supabase-forbindelse. Begge værdier er beregnet til at være offentlige –
// dataene beskyttes af login og Row Level Security i databasen.
// Læg ALDRIG secret- eller service_role-nøglen her.
window.MSK_CONFIG = {
  supabaseUrl: "https://zkicdizuvkkcjowbvrvj.supabase.co",
  supabaseKey: "sb_publishable_cBScoGjeSnZxXvYfS4BtFw_Jwi2Kjt2",
  // Offentlig VAPID-nøgle til notifikationer (se docs/OPSAETNING.md, trin 4).
  vapidPublicKey: "BEnc5Ozz4vskeuFHvvKKrRO9vsJqWy7YTV8pVHAEIiwgfVCrZP9nJYTNXNg-HYJ2Iflp2v9W2JUPjWrNF2FUNAc",
};
