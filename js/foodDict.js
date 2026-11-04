// Diccionario ES -> búsqueda en inglés para USDA.
// No es una traducción literal: es la búsqueda que mejor representa lo que
// una persona quiere decir. Ej.: "arroz" -> "rice white" porque con solo
// "rice" USDA devuelve galletas y snacks antes que el arroz blanco normal.
// Si una palabra no está aquí, foods.js usa MyMemory y guarda el resultado.
// Claves sin acentos y en minúsculas (se normaliza antes de buscar).

const ES_TO_EN = {
  // granos, harinas y panes
  'arroz': 'rice white', 'arroz blanco': 'rice white', 'arroz integral': 'rice brown',
  'avena': 'oats', 'quinoa': 'quinoa', 'maiz': 'corn sweet', 'jojoto': 'corn sweet',
  'harina de maiz': 'cornmeal', 'harina pan': 'cornmeal', 'harina de trigo': 'wheat flour',
  'harina': 'flour', 'pan': 'bread', 'pan integral': 'bread whole wheat', 'pan blanco': 'bread white',
  'pasta': 'pasta', 'espagueti': 'spaghetti', 'espaguetis': 'spaghetti', 'fideos': 'noodles',
  'tortilla': 'tortilla', 'cereal': 'cereal', 'granola': 'granola', 'galleta': 'cookies',
  'galletas': 'cookies', 'galletas de soda': 'crackers saltines', 'casabe': 'cassava',

  // tubérculos y verduras
  'papa': 'potato', 'papas': 'potato', 'batata': 'sweet potato', 'yuca': 'cassava',
  'name': 'yam', 'ocumo': 'taro', 'platano': 'plantain', 'platano maduro': 'plantain ripe',
  'platano verde': 'plantain green', 'topocho': 'plantain', 'auyama': 'pumpkin',
  'zanahoria': 'carrot', 'cebolla': 'onion', 'ajo': 'garlic', 'tomate': 'tomato',
  'pimenton': 'pepper sweet', 'aji': 'pepper', 'lechuga': 'lettuce', 'repollo': 'cabbage',
  'brocoli': 'broccoli', 'coliflor': 'cauliflower', 'espinaca': 'spinach', 'pepino': 'cucumber',
  'calabacin': 'squash zucchini', 'berenjena': 'eggplant', 'champinon': 'mushrooms',
  'champinones': 'mushrooms', 'hongos': 'mushrooms', 'apio': 'celery', 'remolacha': 'beets',
  'vainitas': 'green beans', 'cilantro': 'coriander', 'perejil': 'parsley', 'aguacate': 'avocado',

  // legumbres
  'caraota': 'beans black', 'caraotas': 'beans black', 'caraotas negras': 'beans black',
  'frijol': 'beans', 'frijoles': 'beans', 'lenteja': 'lentils', 'lentejas': 'lentils',
  'garbanzo': 'chickpeas', 'garbanzos': 'chickpeas', 'arvejas': 'peas', 'guisantes': 'peas',
  'soya': 'soybeans', 'tofu': 'tofu',

  // proteínas
  'pollo': 'chicken breast', 'pechuga': 'chicken breast', 'pechuga de pollo': 'chicken breast',
  'muslo': 'chicken thigh', 'muslo de pollo': 'chicken thigh', 'alas de pollo': 'chicken wing',
  'carne': 'beef', 'res': 'beef', 'carne de res': 'beef', 'carne molida': 'beef ground',
  'bistec': 'beef steak', 'higado': 'liver', 'cerdo': 'pork', 'chuleta': 'pork chop',
  'jamon': 'ham', 'tocineta': 'bacon', 'tocino': 'bacon', 'salchicha': 'sausage',
  'chorizo': 'chorizo', 'pavo': 'turkey', 'pescado': 'fish', 'atun': 'tuna', 'salmon': 'salmon',
  'sardina': 'sardines', 'sardinas': 'sardines', 'camaron': 'shrimp', 'camarones': 'shrimp',
  'huevo': 'egg whole', 'huevos': 'egg whole', 'clara': 'egg white', 'claras': 'egg white',
  'clara de huevo': 'egg white', 'yema': 'egg yolk', 'proteina': 'whey protein',
  'proteina whey': 'whey protein',

  // lácteos
  'leche': 'milk', 'leche entera': 'milk whole', 'leche descremada': 'milk nonfat',
  'leche en polvo': 'milk dry', 'queso': 'cheese', 'queso blanco': 'queso fresco',
  'queso amarillo': 'cheese cheddar', 'queso mozzarella': 'cheese mozzarella',
  'yogur': 'yogurt', 'yogurt': 'yogurt', 'yogur griego': 'yogurt greek',
  'mantequilla': 'butter', 'margarina': 'margarine', 'crema': 'cream', 'natilla': 'sour cream',

  // frutas
  'cambur': 'banana', 'banano': 'banana', 'manzana': 'apple', 'pera': 'pear',
  'naranja': 'orange', 'mandarina': 'tangerine', 'limon': 'lemon', 'lima': 'lime',
  'fresa': 'strawberries', 'fresas': 'strawberries', 'uva': 'grapes', 'uvas': 'grapes',
  'pina': 'pineapple', 'mango': 'mango', 'lechosa': 'papaya', 'papaya': 'papaya',
  'parchita': 'passion fruit', 'patilla': 'watermelon', 'sandia': 'watermelon',
  'melon': 'melon cantaloupe', 'durazno': 'peach', 'guayaba': 'guava', 'coco': 'coconut',
  'kiwi': 'kiwi', 'cereza': 'cherries', 'cerezas': 'cherries', 'mora': 'blackberries',
  'moras': 'blackberries', 'arandanos': 'blueberries', 'guanabana': 'soursop',
  'tamarindo': 'tamarind', 'ciruela': 'plum', 'pasas': 'raisins',

  // grasas, frutos secos, endulzantes
  'aceite': 'oil', 'aceite de oliva': 'oil olive', 'aceite vegetal': 'oil vegetable',
  'mani': 'peanuts', 'mantequilla de mani': 'peanut butter', 'almendra': 'almonds',
  'almendras': 'almonds', 'nuez': 'walnuts', 'nueces': 'walnuts', 'merey': 'cashew',
  'azucar': 'sugar', 'papelon': 'sugar brown', 'panela': 'sugar brown', 'miel': 'honey',
  'chocolate': 'chocolate', 'cacao': 'cocoa',

  // bebidas
  'agua': 'water', 'cafe': 'coffee', 'te': 'tea', 'jugo': 'juice',
  'jugo de naranja': 'orange juice', 'refresco': 'carbonated beverage', 'cerveza': 'beer',
  'vino': 'wine', 'ron': 'rum',

  // preparados y salsas
  'mayonesa': 'mayonnaise', 'salsa de tomate': 'ketchup', 'mostaza': 'mustard',
  'palomitas': 'popcorn', 'cotufas': 'popcorn', 'papas fritas': 'french fries',
  'helado': 'ice cream', 'torta': 'cake', 'pizza': 'pizza', 'hamburguesa': 'hamburger',
  'perro caliente': 'hot dog', 'sopa': 'soup', 'ensalada': 'salad', 'sal': 'salt'
};

/** minúsculas, sin acentos, sin signos, espacios simples */
export function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Devuelve la búsqueda en inglés para USDA, o null si el diccionario no la conoce.
 * Prueba la frase completa, luego sin plural, y luego palabra por palabra
 * (solo si todas las palabras se conocen; "con"/"de"/"y" se ignoran).
 */
export function dictQueryToEnglish(query) {
  const q = normalizeText(query);
  if (!q) return null;
  if (ES_TO_EN[q]) return ES_TO_EN[q];
  const singular = q.replace(/(es|s)$/, '');
  if (ES_TO_EN[singular]) return ES_TO_EN[singular];

  const words = q.split(' ').filter(w => !['con', 'de', 'del', 'y', 'la', 'el'].includes(w));
  if (words.length < 2) return null;
  const parts = words.map(w => ES_TO_EN[w] || ES_TO_EN[w.replace(/(es|s)$/, '')]);
  return parts.every(Boolean) ? parts.join(' ') : null;
}
