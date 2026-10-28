require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:5501,http://localhost:5501")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS configuration."));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "30kb" }));

let supabase;
try {
  ({ supabase } = require("./supabase"));
} catch (error) {
  // Let the health endpoint explain setup state; data routes return a useful error.
  console.error(`Supabase configuration: ${error.message}`);
}

const requiredStrings = {
  title: { min: 5, max: 100 },
  location: { min: 2, max: 100 },
  description: { min: 20, max: 1500 },
  contact_name: { min: 2, max: 80 },
  contact_email: { min: 3, max: 254 }
};
const roomTypes = new Set(["Private", "Shared", "Studio"]);

function validateListing(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["Request body must be a JSON object."];
  for (const [field, limits] of Object.entries(requiredStrings)) {
    const value = body[field];
    if (typeof value !== "string" || value.trim().length < limits.min || value.trim().length > limits.max) {
      errors.push(`${field} must be between ${limits.min} and ${limits.max} characters.`);
    }
  }
  if (typeof body.contact_email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact_email.trim())) {
    errors.push("contact_email must be a valid email address.");
  }
  if (!Number.isInteger(Number(body.rent)) || Number(body.rent) < 1 || Number(body.rent) > 10000000) {
    errors.push("rent must be a whole number between 1 and 10000000.");
  }
  if (!roomTypes.has(body.room_type)) errors.push("room_type must be Private, Shared, or Studio.");
  return errors;
}

function normalizedListing(body) {
  return {
    title: body.title.trim(),
    location: body.location.trim(),
    rent: Number(body.rent),
    room_type: body.room_type,
    description: body.description.trim(),
    contact_name: body.contact_name.trim(),
    contact_email: body.contact_email.trim().toLowerCase()
  };
}

function databaseReady(req, res, next) {
  if (!supabase) return res.status(503).json({ error: "Database is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in backend/.env, then restart the server." });
  next();
}
function sendDbError(res, error) {
  console.error("Supabase request failed:", error.message || error);
  return res.status(500).json({ error: "Database request failed. Check the Supabase schema, API key, RLS policies, and server logs." });
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", databaseConfigured: Boolean(supabase), time: new Date().toISOString() });
});

app.get("/api/listings", databaseReady, async (req, res) => {
  try {
    let query = supabase.from("listings")
      .select("id,title,location,rent,room_type,description,contact_name,contact_email,created_at,updated_at")
      .order("created_at", { ascending: false }).limit(100);
    if (typeof req.query.location === "string" && req.query.location.trim()) query = query.ilike("location", `%${req.query.location.trim().replace(/[%_,]/g, "")}%`);
    if (req.query.maxRent !== undefined && req.query.maxRent !== "") {
      const maxRent = Number(req.query.maxRent);
      if (!Number.isFinite(maxRent) || maxRent < 0 || maxRent > 10000000) return res.status(400).json({ error: "maxRent must be a number between 0 and 10000000." });
      query = query.lte("rent", maxRent);
    }
    if (typeof req.query.roomType === "string" && req.query.roomType) {
      if (!roomTypes.has(req.query.roomType)) return res.status(400).json({ error: "roomType must be Private, Shared, or Studio." });
      query = query.eq("room_type", req.query.roomType);
    }
    const { data, error } = await query;
    if (error) return sendDbError(res, error);
    res.json({ data });
  } catch (error) { return sendDbError(res, error); }
});

app.get("/api/listings/:id", databaseReady, async (req, res) => {
  try {
    const { data, error } = await supabase.from("listings")
      .select("id,title,location,rent,room_type,description,contact_name,contact_email,created_at,updated_at")
      .eq("id", req.params.id).maybeSingle();
    if (error) return sendDbError(res, error);
    if (!data) return res.status(404).json({ error: "Listing not found." });
    res.json({ data });
  } catch (error) { return sendDbError(res, error); }
});

app.post("/api/listings", databaseReady, async (req, res) => {
  const errors = validateListing(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(" "), details: errors });
  try {
    const listing = { ...normalizedListing(req.body), id: randomUUID() };
    const { data, error } = await supabase.from("listings")
      .insert(listing)
      .select("id,title,location,rent,room_type,description,contact_name,contact_email,created_at,updated_at")
      .single();
    if (error) return sendDbError(res, error);
    res.status(201).json({ data });
  } catch (error) { return sendDbError(res, error); }
});

app.put("/api/listings/:id", databaseReady, async (req, res) => {
  const errors = validateListing(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(" "), details: errors });
  try {
    const { data, error } = await supabase.from("listings").update(normalizedListing(req.body))
      .eq("id", req.params.id)
      .select("id,title,location,rent,room_type,description,contact_name,contact_email,created_at,updated_at")
      .maybeSingle();
    if (error) return sendDbError(res, error);
    if (!data) return res.status(404).json({ error: "Listing not found or cannot be updated under the current database policy." });
    res.json({ data });
  } catch (error) { return sendDbError(res, error); }
});

app.delete("/api/listings/:id", databaseReady, async (req, res) => {
  try {
    const { data, error } = await supabase.from("listings").delete().eq("id", req.params.id)
      .select("id").maybeSingle();
    if (error) return sendDbError(res, error);
    if (!data) return res.status(404).json({ error: "Listing not found or cannot be deleted under the current database policy." });
    res.json({ data: { id: data.id, deleted: true } });
  } catch (error) { return sendDbError(res, error); }
});

app.use((req, res) => res.status(404).json({ error: "Route not found." }));
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "Invalid JSON request body." });
  if (error.message && error.message.includes("CORS")) return res.status(403).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => console.log(`Roomie API listening on http://localhost:${PORT}`));
