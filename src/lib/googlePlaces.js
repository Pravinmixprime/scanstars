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

// Live-as-you-type suggestions (Place Autocomplete (New)) — this is what
// powers the "start typing and see matches" box on the Add Shop form. A
// sessionToken (any string the frontend makes up per search session, e.g. a
// random UUID) should be passed through and reused for all keystrokes of
// one search, then dropped once a place is chosen — that's what lets
// Google bill the whole typing session as one unit instead of per
// keystroke.
async function autocomplete(input, sessionToken) {
  var body = { input: input };
  if (sessionToken) body.sessionToken = sessionToken;

  var res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    var errText = await res.text().catch(() => "");
    throw new Error("Google Places API error (" + res.status + "): " + errText.slice(0, 300));
  }

  var data = await res.json();
  var suggestions = data.suggestions || [];
  return suggestions
    .filter((s) => s.placePrediction)
    .map((s) => {
      var p = s.placePrediction;
      var mainText = (p.structuredFormat && p.structuredFormat.mainText && p.structuredFormat.mainText.text) || (p.text && p.text.text) || "";
      var secondaryText = (p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || "";
      return { placeId: p.placeId, name: mainText, address: secondaryText };
    });
}

module.exports = { isConfigured, searchPlaces, autocomplete };
