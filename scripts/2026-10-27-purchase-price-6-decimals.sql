-- Purchase prices with 6 decimals, so a price list imported TTC keeps exactly its TTC (with 3 decimals
-- of HT, about 1 TTC price in 9 came back 1 millime off). Widening only: no value changes.
ALTER TABLE products ALTER COLUMN purchase_price TYPE numeric(16,6);
