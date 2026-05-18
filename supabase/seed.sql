-- ============================================================================
-- MarketMind seed: 50 curated stocks across sectors
-- Run AFTER initial schema migration.
-- ============================================================================

insert into public.stocks (ticker, name, sector, sub_sector, market_cap_tier) values
  -- Mega cap tech (10)
  ('AAPL',  'Apple Inc.',                  'Technology', 'Consumer Electronics',   'mega'),
  ('MSFT',  'Microsoft Corporation',        'Technology', 'Software',               'mega'),
  ('NVDA',  'NVIDIA Corporation',           'Technology', 'Semiconductors',         'mega'),
  ('GOOGL', 'Alphabet Inc. (Class A)',      'Technology', 'Internet Services',      'mega'),
  ('META',  'Meta Platforms Inc.',          'Technology', 'Social Media',           'mega'),
  ('AMZN',  'Amazon.com Inc.',              'Technology', 'E-commerce / Cloud',     'mega'),
  ('TSLA',  'Tesla Inc.',                   'Technology', 'Electric Vehicles',      'mega'),
  ('AVGO',  'Broadcom Inc.',                'Technology', 'Semiconductors',         'mega'),
  ('ORCL',  'Oracle Corporation',           'Technology', 'Enterprise Software',    'mega'),
  ('ADBE',  'Adobe Inc.',                   'Technology', 'Creative Software',      'mega'),

  -- Tech / Software (5)
  ('CRM',   'Salesforce Inc.',              'Technology', 'CRM / Cloud',            'large'),
  ('NOW',   'ServiceNow Inc.',              'Technology', 'Enterprise SaaS',        'large'),
  ('INTU',  'Intuit Inc.',                  'Technology', 'Financial Software',     'large'),
  ('AMD',   'Advanced Micro Devices Inc.',  'Technology', 'Semiconductors',         'large'),
  ('INTC',  'Intel Corporation',            'Technology', 'Semiconductors',         'large'),

  -- Retail favorites / meme (8)
  ('PLTR',  'Palantir Technologies Inc.',   'Technology', 'Data Analytics',         'large'),
  ('GME',   'GameStop Corp.',               'Consumer',   'Specialty Retail',       'mid'),
  ('RIVN',  'Rivian Automotive Inc.',       'Consumer',   'Electric Vehicles',      'mid'),
  ('SOFI',  'SoFi Technologies Inc.',       'Financial',  'Fintech',                'mid'),
  ('COIN',  'Coinbase Global Inc.',         'Financial',  'Crypto Exchange',        'large'),
  ('HOOD',  'Robinhood Markets Inc.',       'Financial',  'Brokerage',              'mid'),
  ('RDDT',  'Reddit Inc.',                  'Technology', 'Social Media',           'mid'),
  ('AFRM',  'Affirm Holdings Inc.',         'Financial',  'BNPL',                   'mid'),

  -- Finance (6)
  ('JPM',   'JPMorgan Chase & Co.',         'Financial',  'Banking',                'mega'),
  ('BAC',   'Bank of America Corporation',  'Financial',  'Banking',                'mega'),
  ('GS',    'The Goldman Sachs Group Inc.', 'Financial',  'Investment Banking',     'large'),
  ('V',     'Visa Inc.',                    'Financial',  'Payment Networks',       'mega'),
  ('MA',    'Mastercard Incorporated',      'Financial',  'Payment Networks',       'mega'),
  ('BRK.B', 'Berkshire Hathaway Inc.',      'Financial',  'Conglomerate',           'mega'),

  -- Healthcare / Biotech (5)
  ('JNJ',   'Johnson & Johnson',            'Healthcare', 'Pharmaceuticals',        'mega'),
  ('PFE',   'Pfizer Inc.',                  'Healthcare', 'Pharmaceuticals',        'large'),
  ('MRNA',  'Moderna Inc.',                 'Healthcare', 'Biotech',                'mid'),
  ('LLY',   'Eli Lilly and Company',        'Healthcare', 'Pharmaceuticals',        'mega'),
  ('UNH',   'UnitedHealth Group Inc.',      'Healthcare', 'Health Insurance',       'mega'),

  -- Energy / EV (4)
  ('XOM',   'Exxon Mobil Corporation',      'Energy',     'Oil & Gas',              'mega'),
  ('CVX',   'Chevron Corporation',          'Energy',     'Oil & Gas',              'mega'),
  ('NIO',   'NIO Inc.',                     'Consumer',   'Electric Vehicles',      'mid'),
  ('LCID',  'Lucid Group Inc.',             'Consumer',   'Electric Vehicles',      'mid'),

  -- Consumer (7)
  ('SBUX',  'Starbucks Corporation',        'Consumer',   'Restaurants',            'large'),
  ('NKE',   'NIKE Inc.',                    'Consumer',   'Apparel',                'large'),
  ('MCD',   'McDonald''s Corporation',       'Consumer',   'Restaurants',            'mega'),
  ('DIS',   'The Walt Disney Company',      'Consumer',   'Media / Entertainment',  'large'),
  ('COST',  'Costco Wholesale Corporation', 'Consumer',   'Retail',                 'mega'),
  ('WMT',   'Walmart Inc.',                 'Consumer',   'Retail',                 'mega'),
  ('TGT',   'Target Corporation',           'Consumer',   'Retail',                 'large'),

  -- AI / Semis (5)
  ('ARM',   'Arm Holdings plc',             'Technology', 'Semiconductors',         'large'),
  ('SMCI',  'Super Micro Computer Inc.',    'Technology', 'Server Hardware',        'mid'),
  ('MU',    'Micron Technology Inc.',       'Technology', 'Semiconductors',         'large'),
  ('QCOM',  'QUALCOMM Incorporated',        'Technology', 'Semiconductors',         'large'),
  ('TSM',   'Taiwan Semiconductor Mfg.',    'Technology', 'Semiconductor Foundry',  'mega')
on conflict (ticker) do nothing;
