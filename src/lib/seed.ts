import { addDays, todayISO } from "./dates";
import { getDb, withTransaction } from "./db";
import { createAdjustment, createItem, createPurchase, type ItemRecord } from "./inventory";
import { saveProduct } from "./products";
import { saveSale } from "./sales";

export async function seedIfEmpty(): Promise<void> {
  const row = (await (await getDb()).prepare("SELECT COUNT(*) AS c FROM inventory_items").get()) as { c: number };
  if (row.c > 0) return;
  await withTransaction(async () => {
    const today = todayISO();
    const earlier = Number(today.slice(8, 10)) >= 12 ? addDays(today, -10) : today;
    const laterPurchase = Number(today.slice(8, 10)) >= 12 ? addDays(today, -6) : today;
    const wastageDay = Number(today.slice(8, 10)) >= 2 ? addDays(today, -1) : today;

    const flour = await item("All-Purpose Flour", "ingredient", "🌾", "g", 5000);
    const sugar = await item("Sugar", "ingredient", "🍬", "g", 2000);
    const butter = await item("Butter", "ingredient", "🧈", "g", 1000);
    const eggs = await item("Eggs", "ingredient", "🥚", "pcs", 30);
    const cocoa = await item("Cocoa Powder", "ingredient", "🍫", "g", 200);
    const chips = await item("Chocolate Chips", "ingredient", "🍪", "g", 400);
    const bananas = await item("Bananas", "ingredient", "🍌", "g", 500);
    const boxes = await item("Cake Boxes", "packaging", "📦", "pcs", 10);
    const boards = await item("Cake Boards", "packaging", "🪵", "pcs", 10);

    await createPurchase({
      itemId: flour.id,
      amount: 10,
      unit: "kg",
      cost: 500,
      date: earlier,
      supplier: "Mercado Grains",
    });
    await createPurchase({
      itemId: flour.id,
      amount: 15,
      unit: "kg",
      cost: 925,
      date: laterPurchase,
      supplier: "Mercado Grains",
    });
    await createPurchase({ itemId: sugar.id, amount: 10, unit: "kg", cost: 680, date: earlier, supplier: "Mercado Grains" });
    await createPurchase({ itemId: butter.id, amount: 5, unit: "kg", cost: 1750, date: earlier, supplier: "Dairy Co-op" });
    await createPurchase({ itemId: eggs.id, amount: 188, unit: "pcs", cost: 1551, date: earlier, supplier: "Barrio Poultry" });
    await createPurchase({ itemId: cocoa.id, amount: 1, unit: "kg", cost: 480, date: earlier, supplier: "Mercado Grains" });
    await createPurchase({ itemId: chips.id, amount: 2, unit: "kg", cost: 760, date: earlier, supplier: "Mercado Grains" });
    await createPurchase({ itemId: bananas.id, amount: 3, unit: "kg", cost: 180, date: earlier, supplier: "Fruit stall" });
    await createPurchase({ itemId: boxes.id, amount: 40, unit: "pcs", cost: 600, date: earlier, supplier: "Pack Right" });
    await createPurchase({ itemId: boards.id, amount: 8, unit: "pcs", cost: 200, date: earlier, supplier: "Pack Right" });

    await createAdjustment({
      itemId: butter.id,
      amount: 250,
      unit: "g",
      direction: "remove",
      reason: "damaged",
      note: "Bag tore during storage",
      date: wastageDay,
    });

    const cake = await saveProduct({
      name: "Chocolate Cake",
      icon: "🎂",
      defaultPrice: 850,
      recipe: [
        { itemId: flour.id, quantityBase: 500 },
        { itemId: sugar.id, quantityBase: 300 },
        { itemId: butter.id, quantityBase: 250 },
        { itemId: eggs.id, quantityBase: 4 },
        { itemId: cocoa.id, quantityBase: 80 },
        { itemId: boxes.id, quantityBase: 1 },
        { itemId: boards.id, quantityBase: 1 },
      ],
    });
    await saveProduct({
      name: "Brownies",
      icon: "🍫",
      defaultPrice: 180,
      recipe: [
        { itemId: flour.id, quantityBase: 200 },
        { itemId: sugar.id, quantityBase: 250 },
        { itemId: butter.id, quantityBase: 200 },
        { itemId: eggs.id, quantityBase: 2 },
        { itemId: cocoa.id, quantityBase: 50 },
        { itemId: chips.id, quantityBase: 80 },
      ],
    });
    await saveProduct({
      name: "Cookies",
      icon: "🍪",
      defaultPrice: 150,
      recipe: [
        { itemId: flour.id, quantityBase: 280 },
        { itemId: sugar.id, quantityBase: 150 },
        { itemId: butter.id, quantityBase: 180 },
        { itemId: eggs.id, quantityBase: 1 },
        { itemId: chips.id, quantityBase: 120 },
      ],
    });
    await saveProduct({
      name: "Banana Bread",
      icon: "🍌",
      defaultPrice: 220,
      recipe: [
        { itemId: flour.id, quantityBase: 250 },
        { itemId: sugar.id, quantityBase: 150 },
        { itemId: butter.id, quantityBase: 100 },
        { itemId: eggs.id, quantityBase: 2 },
        { itemId: bananas.id, quantityBase: 300 },
      ],
    });

    await saveSale({
      soldAt: today,
      lines: [
        {
          productId: cake.id,
          quantity: 1,
          unitPrice: 850,
          consumptions: cake.recipe.map((line) => ({ itemId: line.itemId, quantityBase: line.quantityBase })),
        },
      ],
    });
  });
}

function item(
  name: string,
  category: ItemRecord["category"],
  icon: string,
  baseUnit: ItemRecord["baseUnit"],
  minimumStock: number,
) {
  return createItem({ name, category, icon, baseUnit, minimumStock });
}
