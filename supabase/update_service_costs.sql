-- Update service_cost for all clients
-- Default 1200 AED for active clients

UPDATE clients SET service_cost = 1200 WHERE service_cost IS NULL AND is_active = true;

-- Specific overrides for clients with different pricing
UPDATE clients SET service_cost = 800 WHERE id = 'de32ee56-59b1-8e38-2667-f3741e7ccbd1'; -- ARMN MILLIONAIRE - Alessandro Armeni
UPDATE clients SET service_cost = 800 WHERE id = '92b1ec96-0bc8-2146-0119-1c755987fe99'; -- ECOMSHARK - Daniele Bova
UPDATE clients SET service_cost = 1800 WHERE id = 'd4b409c3-f197-a8c1-62d9-c28c95898b08'; -- EVOLVER - Marco Russo
UPDATE clients SET service_cost = 800 WHERE id = 'a444bb06-cd06-f471-c8bd-e541868d1c01'; -- MCG GLOBAL  - Marco Catuadella e Alessandro
UPDATE clients SET service_cost = 1800 WHERE id = 'ec260a6f-0b19-719a-29fb-1df87aba87ae'; -- STARPAY - Marco Russo