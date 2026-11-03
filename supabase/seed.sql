-- =====================================================================
-- Datos iniciales: red Dr Beauty, sucursales y catálogo de tratamientos.
-- Se puede correr más de una vez sin duplicar nada.
-- recall_days = cada cuántos días se recontacta a la paciente.
-- Son valores iniciales: ajustalos con el equipo médico.
-- =====================================================================

insert into public.organizations (id, name, slug, loyalty_points_per_1000, settings)
values (
  '00000000-0000-0000-0000-00000000d0b0',
  'Dr Beauty',
  'drbeauty',
  1,  -- 1 Beauty Milla por cada $1.000 cobrados
  jsonb_build_object(
    'brand', jsonb_build_object(
      'logo_url', '/brand/drbeauty-logo.svg',
      'monogram_url', '/brand/drbeauty-monograma.svg'
    ),
    'recall_message',
    'Hola {nombre}! Te escribimos de Dr. Beauty {sucursal}. Ya pasaron {meses} meses de tu {tratamiento}. ¿Querés que te reservemos un turno para mantener el resultado?'
  )
)
on conflict (slug) do update
  set settings = public.organizations.settings || jsonb_build_object('brand', excluded.settings->'brand');

insert into public.branches (organization_id, name, address, phone, whatsapp)
values
  ('00000000-0000-0000-0000-00000000d0b0', 'Ramos Mejía',          'Av. de Mayo 652, Ramos Mejía',              '1164801662',  '5491164801662'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Palermo',              'Jerónimo Salguero 2745, CABA',              '1157013010',  '5491157013010'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Villa Devoto',         'Cuenca 3555, CABA',                         '1140805446',  '5491140805446'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Córdoba',              'José Roque Funes, Cerro de las Rosas',      '3518728888',  '5493518728888'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Bahía Blanca',         'Martiniano Rodríguez 432',                  '2915781715',  '5492915781715'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Villa Urquiza',        'Nahuel Huapi 4240, CABA',                   '1131021538',  '5491131021538'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Recoleta',             'Av. Quintana 492, CABA',                    '1130877847',  '5491130877847'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Las Lomitas',          'Hipólito Yrigoyen 9448',                    '1124675109',  '5491124675109'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Olivos/Vicente López', 'Av. del Libertador 2861',                   '1124516531',  '5491124516531'),
  ('00000000-0000-0000-0000-00000000d0b0', 'San Isidro',           'Blanco Encalada 197 of. 43',                '1163003900',  '5491163003900'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Caballito',            'Pedro Goyena 370, CABA',                    '1121787313',  '5491121787313'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Nordelta',             'Pje. de las Ciencias 75',                   '1161566006',  '5491161566006'),
  ('00000000-0000-0000-0000-00000000d0b0', 'Puerto Madero',        'Juana Manso 1101, CABA',                    '1166707496',  '5491166707496')
on conflict (organization_id, name) do nothing;

insert into public.treatments (organization_id, name, category, recall_days, unit_label, sort_order)
values
  ('00000000-0000-0000-0000-00000000d0b0', 'Botox (toxina botulínica)',     'Facial',      120, 'unidades', 10),
  ('00000000-0000-0000-0000-00000000d0b0', 'Ácido hialurónico - labios',    'Facial',      270, 'ml',       20),
  ('00000000-0000-0000-0000-00000000d0b0', 'Ácido hialurónico - surcos',    'Facial',      365, 'ml',       30),
  ('00000000-0000-0000-0000-00000000d0b0', 'Ácido hialurónico - ojeras',    'Facial',      365, 'ml',       40),
  ('00000000-0000-0000-0000-00000000d0b0', 'Ácido hialurónico - otras zonas','Facial',     365, 'ml',       50),
  ('00000000-0000-0000-0000-00000000d0b0', 'Rinomodelado',                  'Facial',      365, 'ml',       60),
  ('00000000-0000-0000-0000-00000000d0b0', 'Hilos tensores faciales',       'Facial',      365, 'hilos',    70),
  ('00000000-0000-0000-0000-00000000d0b0', 'FoxEyes',                       'Facial',      365, 'hilos',    80),
  ('00000000-0000-0000-0000-00000000d0b0', 'Sculptra facial',               'Facial',      365, 'viales',   90),
  ('00000000-0000-0000-0000-00000000d0b0', 'Radiesse',                      'Facial',      365, 'jeringas', 100),
  ('00000000-0000-0000-0000-00000000d0b0', 'Profhilo',                      'Facial',      180, 'sesión',   110),
  ('00000000-0000-0000-0000-00000000d0b0', 'Long Lasting',                  'Facial',      180, 'sesión',   120),
  ('00000000-0000-0000-0000-00000000d0b0', 'Plasma rico en plaquetas',      'Facial',       30, 'sesión',   130),
  ('00000000-0000-0000-0000-00000000d0b0', 'MELA',                          'Corporal',   null, 'zona',     200),
  ('00000000-0000-0000-0000-00000000d0b0', 'Chip hormonal',                 'Corporal',    150, 'pellet',   210),
  ('00000000-0000-0000-0000-00000000d0b0', 'Hilos tensores glúteos',        'Corporal',    365, 'hilos',    220),
  ('00000000-0000-0000-0000-00000000d0b0', 'Hilos tensores abdomen',        'Corporal',    365, 'hilos',    230),
  ('00000000-0000-0000-0000-00000000d0b0', 'Sculptra corporal',             'Corporal',    365, 'viales',   240),
  ('00000000-0000-0000-0000-00000000d0b0', 'Plasma - celulitis',            'Corporal',     30, 'sesión',   250),
  ('00000000-0000-0000-0000-00000000d0b0', 'Láser Nordlys',                 'Aparatología', 30, 'sesión',   300),
  ('00000000-0000-0000-0000-00000000d0b0', 'HIFU',                          'Aparatología',365, 'sesión',   310),
  ('00000000-0000-0000-0000-00000000d0b0', 'Scizer',                        'Aparatología', 30, 'sesión',   320),
  ('00000000-0000-0000-0000-00000000d0b0', 'DermoSculpt',                   'Aparatología', 30, 'sesión',   330),
  ('00000000-0000-0000-0000-00000000d0b0', 'Consulta médica',               'Consulta',   null, null,       400),
  ('00000000-0000-0000-0000-00000000d0b0', 'Cirugía (consulta/cirugía)',    'Cirugía',    null, null,       500)
on conflict (organization_id, name) do nothing;
