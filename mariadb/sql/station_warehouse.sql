/**
 * Tabela de estoque de itens nas estações espaciais
 */
CREATE TABLE IF NOT EXISTS `station_warehouse` (
  `station_id` INT(11) NOT NULL COMMENT 'Código da estação (orbit_stations.id)',
  `item_code` INT(10) UNSIGNED NOT NULL COMMENT 'Código do item (items.item_code)',
  `pilot_uid` INT(10) UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Código do jogador anunciante (0 = item da própria estação)',
  `stock_balance` INT(11) NOT NULL DEFAULT 0 COMMENT 'Saldo atual do estoque',
  `status` ENUM('ativo', 'inativo', 'suspenso') NOT NULL DEFAULT 'ativo' COMMENT 'Situação do item no estoque',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  PRIMARY KEY (`station_id`, `item_code`, `pilot_uid`),
  KEY `idx_station_id` (`station_id`),
  KEY `idx_item_code` (`item_code`),
  KEY `idx_pilot_uid` (`pilot_uid`),
  CONSTRAINT `fk_sw_station` FOREIGN KEY (`station_id`) REFERENCES `orbit_stations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sw_item` FOREIGN KEY (`item_code`) REFERENCES `items` (`item_code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Estoque de itens nas estações espaciais';


/**
 * Carga inicial: popula todas as estações do tipo 'fabrica' com os itens da tabela 'items'
 * Saldo inicial: 10 unidades para cada item, pertencentes à própria estação (pilot_uid = 0)
 */
INSERT INTO `station_warehouse` (`station_id`, `item_code`, `pilot_uid`, `stock_balance`, `status`)
SELECT 
    s.id AS station_id,
    i.item_code,
    0 AS pilot_uid,
    10 AS stock_balance,
    'ativo' AS status
FROM `orbit_stations` s
CROSS JOIN `items` i
WHERE s.station_type = 'fabrica'
ON DUPLICATE KEY UPDATE 
    `stock_balance` = 10,
    `status` = 'ativo';
