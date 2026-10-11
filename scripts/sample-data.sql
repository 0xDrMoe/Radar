-- Invented sample data for local development of the public code. Every restaurant, address and
-- deal here is fictional, and every link points at example.com. Apply it to a local database only:
--
--   npx wrangler d1 execute radar --local --file scripts/sample-data.sql
--
-- Not a migration on purpose: a deployment that ran it would publish fake deals.

INSERT INTO restaurants(id,name,website,cuisine,slug,country,vertical) VALUES
  ('sample-maple-tavern','Maple Tavern (sample)','https://example.com/maple-tavern','Canadian','sample-maple-tavern','CA','restaurant'),
  ('sample-lantern-noodle','Lantern Noodle Bar (sample)','https://example.com/lantern-noodle','Japanese','sample-lantern-noodle','CA','restaurant'),
  ('sample-casa-verde','Casa Verde Taqueria (sample)','https://example.com/casa-verde','Mexican','sample-casa-verde','CA','restaurant');

INSERT INTO restaurant_locations(id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone,slug) VALUES
  ('sample-maple-tavern-location','sample-maple-tavern','100 Example St','Ottawa','ON','CA','K1P',45.4215,-75.6972,'America/Toronto','sample-maple-tavern-location'),
  ('sample-lantern-noodle-location','sample-lantern-noodle','200 Example Ave','Ottawa','ON','CA','K1N',45.4270,-75.6920,'America/Toronto','sample-lantern-noodle-location'),
  ('sample-casa-verde-location','sample-casa-verde','300 Example Rd','Ottawa','ON','CA','K1S',45.4030,-75.6880,'America/Toronto','sample-casa-verde-location');

INSERT INTO deals(id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,restaurant_id,location_id,status,verification_status,slug,description,created_at) VALUES
  ('sample-maple-tavern-happy-hour','Maple Tavern (sample)','Half-price appetizers','Happy hour','Canadian','Mon–Fri 3–6 PM','Ottawa','K1P','100 Example St','50% off appetizers','🍻','https://example.com/maple-tavern','sample-maple-tavern','sample-maple-tavern-location','live','verified','sample-maple-tavern-happy-hour','Sample deal: half-price appetizers on weekday afternoons.',CURRENT_TIMESTAMP),
  ('sample-lantern-noodle-ramen-tuesday','Lantern Noodle Bar (sample)','$12 ramen Tuesdays','Food deal','Japanese','Tuesdays','Ottawa','K1N','200 Example Ave','$12 any ramen','🍜','https://example.com/lantern-noodle','sample-lantern-noodle','sample-lantern-noodle-location','live','verified','sample-lantern-noodle-ramen-tuesday','Sample deal: any bowl of ramen for $12 on Tuesdays.',CURRENT_TIMESTAMP),
  ('sample-casa-verde-taco-night','Casa Verde Taqueria (sample)','$2 tacos after 8','Food deal','Mexican','Daily 8–10 PM','Ottawa','K1S','300 Example Rd','$2 tacos','🌮','https://example.com/casa-verde','sample-casa-verde','sample-casa-verde-location','live','verified','sample-casa-verde-taco-night','Sample deal: two-dollar tacos late every evening.',CURRENT_TIMESTAMP);

INSERT INTO deal_locations(deal_id,location_id,eligibility,source_url,verified_at) VALUES
  ('sample-maple-tavern-happy-hour','sample-maple-tavern-location','confirmed','https://example.com/maple-tavern',CURRENT_TIMESTAMP),
  ('sample-lantern-noodle-ramen-tuesday','sample-lantern-noodle-location','confirmed','https://example.com/lantern-noodle',CURRENT_TIMESTAMP),
  ('sample-casa-verde-taco-night','sample-casa-verde-location','confirmed','https://example.com/casa-verde',CURRENT_TIMESTAMP);

INSERT INTO deal_schedules(deal_id,display_text,days,start_time,end_time,timezone) VALUES
  ('sample-maple-tavern-happy-hour','Mon–Fri 3–6 PM','["mon","tue","wed","thu","fri"]','15:00','18:00','America/Toronto'),
  ('sample-lantern-noodle-ramen-tuesday','Tuesdays','["tue"]',NULL,NULL,'America/Toronto'),
  ('sample-casa-verde-taco-night','Daily 8–10 PM','["sun","mon","tue","wed","thu","fri","sat"]','20:00','22:00','America/Toronto');
