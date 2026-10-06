-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_budget_line" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "month" TEXT NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "limit_cents" INTEGER NOT NULL,
    "carry_in_cents" INTEGER NOT NULL DEFAULT 0,
    "rollover" BOOLEAN NOT NULL,
    "deficit_paid_cents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "budget_line_month_fkey" FOREIGN KEY ("month") REFERENCES "budget_month" ("month") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "budget_line_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_budget_line" ("carry_in_cents", "id", "limit_cents", "month", "rollover", "subcategory_id") SELECT "carry_in_cents", "id", "limit_cents", "month", "rollover", "subcategory_id" FROM "budget_line";
DROP TABLE "budget_line";
ALTER TABLE "new_budget_line" RENAME TO "budget_line";
CREATE UNIQUE INDEX "budget_line_month_subcategory_id_key" ON "budget_line"("month", "subcategory_id");
CREATE TABLE "new_savings_entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL DEFAULT 'sweep',
    "month" TEXT NOT NULL,
    "subcategory_id" INTEGER,
    "budget_line_id" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "savings_entry_month_fkey" FOREIGN KEY ("month") REFERENCES "budget_month" ("month") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "savings_entry_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "savings_entry_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_line" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_savings_entry" ("amount_cents", "created_at", "id", "month", "subcategory_id") SELECT "amount_cents", "created_at", "id", "month", "subcategory_id" FROM "savings_entry";
DROP TABLE "savings_entry";
ALTER TABLE "new_savings_entry" RENAME TO "savings_entry";
CREATE INDEX "savings_entry_month_idx" ON "savings_entry"("month");
CREATE INDEX "savings_entry_budget_line_id_idx" ON "savings_entry"("budget_line_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
