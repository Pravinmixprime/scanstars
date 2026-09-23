// Thin wrapper around Google's Places API (New) "Text Search" endpoint —
// lets an agent search by shop name (and city) instead of hunting for the
// Place ID by hand. Only ever returns id/name/address; never touches
// reviews or review content, so it doesn't raise any of the review-policy
// concerns a "write reviews for the customer" feature would.
//
// Requires GOOGLE_PLACES_API_KEY in .env — a key from a Google Cloud
// project with the "Places API (New)" enabled. See .env.example for setup
// notes. Uses the global fetch built into Node 18+, so no extra dependency.

var API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function isConfigured() {
  return !!(API_KEY && API_KEY.indexOf("xxxx") === -1);
}

// Returns up to 5 candidate places for a free-text query like
// "Sharma Sweets, Andheri Mumbai". Throws on network/API errors so the
// route can turn that into a clean 502 for the frontend.
async function searchPlaces(query) {
  var res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      // Keeping the field mask to just id/name/address is what qualifies
      // this call for Google's (cheaper) Text Search Pro SKU rather than
      // pulling in ratings/hours/etc, which would bill at a higher tier.
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress"
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5 })
  });

  if (!res.ok) {
    var errText = await res.text().catch(() => "");
    throw new Error("Google Places API error (" + res.status + "): " + errText.slice(0, 300));
  }

  var data = await res.json();
  var places = data.places || [];
  return places.map((p) => ({
    placeId: p.id,
    name: (p.displayName && p.displayName.text) || "",
    address: p.formattedAddress || ""
  }));
}

module.exports = { isConfigured, searchPlaces };
