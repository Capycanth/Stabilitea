-- CreateTable
CREATE TABLE "category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rollover" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" DATETIME
);

-- CreateTable
CREATE TABLE "subcategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "default_limit_cents" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" DATETIME,
    CONSTRAINT "subcategory_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "budget_month" (
    "month" TEXT NOT NULL PRIMARY KEY,
    "planned_income_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closed_at" DATETIME
);

-- CreateTable
CREATE TABLE "budget_line" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "month" TEXT NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "limit_cents" INTEGER NOT NULL,
    "carry_in_cents" INTEGER NOT NULL DEFAULT 0,
    "rollover" BOOLEAN NOT NULL,
    CONSTRAINT "budget_line_month_fkey" FOREIGN KEY ("month") REFERENCES "budget_month" ("month") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "budget_line_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "payee" TEXT,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "transaction_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "savings_entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "month" TEXT NOT NULL,
    "subcategory_id" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "savings_entry_month_fkey" FOREIGN KEY ("month") REFERENCES "budget_month" ("month") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "savings_entry_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "subcategory_category_id_name_key" ON "subcategory"("category_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "budget_line_month_subcategory_id_key" ON "budget_line"("month", "subcategory_id");

-- CreateIndex
CREATE INDEX "transaction_date_idx" ON "transaction"("date");

-- CreateIndex
CREATE INDEX "transaction_subcategory_id_idx" ON "transaction"("subcategory_id");

-- CreateIndex
CREATE INDEX "savings_entry_month_idx" ON "savings_entry"("month");
