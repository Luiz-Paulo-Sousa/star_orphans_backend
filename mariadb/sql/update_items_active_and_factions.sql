-- Atualização do campo active na tabela items
-- Permitindo apenas 'SIM' e 'NÃO' com default 'SIM'
ALTER TABLE items MODIFY COLUMN active ENUM('SIM', 'NÃO') NOT NULL DEFAULT 'SIM';
UPDATE items SET active = 'SIM';

-- Garantir chave primária em factions
ALTER TABLE factions MODIFY COLUMN faction_uid INT NOT NULL PRIMARY KEY;

-- Tabela de itens exclusivos por facção
CREATE TABLE IF NOT EXISTS faction_exclusive_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_uid INT NOT NULL,
    item_code INT(10) UNSIGNED NOT NULL,
    min_reputation INT NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_faction_item (faction_uid, item_code),
    INDEX idx_faction_uid (faction_uid),
    INDEX idx_item_code (item_code),
    CONSTRAINT fk_fei_faction FOREIGN KEY (faction_uid) REFERENCES factions(faction_uid) ON DELETE CASCADE,
    CONSTRAINT fk_fei_item FOREIGN KEY (item_code) REFERENCES items(item_code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
